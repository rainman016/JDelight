import {
  analysisInputSchema,
  type AnalysisInput,
  type AnalysisResponse,
  type AnalysisStatus,
} from "@/domain/analysis";
import {
  classifySourceLine,
  type SourceLine,
  type SourceSection,
} from "@/domain/source";
import { reportContentSchema } from "@/domain/report";
export class AnalysisClientError extends Error {
  constructor(
    public readonly kind: "check" | "quota" | "network" | "config",
    public readonly reasons: string[],
  ) {
    super(reasons.join("；"));
    this.name = "AnalysisClientError";
  }
}
export async function analysisStatus(): Promise<AnalysisStatus | null> {
  try {
    const response = await fetch("/api/analysis/status", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as AnalysisStatus;
    if (
      typeof data.available !== "boolean" ||
      ![
        data.used,
        data.maxCalls,
        data.costUsedCny,
        data.maxCostCny,
        data.uiRemaining,
      ].every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isInteger(data.uiRemaining) ||
      data.uiRemaining > data.maxCalls
    )
      return null;
    return data;
  } catch {
    return null;
  }
}
export async function analyzeWithModel(
  source: AnalysisInput,
  onProgress: (p: { stage: number; done: number; total: number }) => void,
  signal: AbortSignal,
) {
  const raw = source.text.split(/\r\n|\n|\r/);
  const lines: SourceLine[] = [];
  const counts = { meta: 0, duty: 0, must: 0, bonus: 0, other: 0 };
  let section: SourceSection = "meta";
  const batch = Math.max(1, Math.ceil(raw.length / 30));
  for (let stage = 0; stage < 2; stage++) {
    for (let i = 0; i < raw.length; i += batch) {
      signal.throwIfAborted();
      for (let n = i; n < Math.min(i + batch, raw.length); n++) {
        if (stage === 0)
          lines.push({
            lineNo: n + 1,
            text: raw[n],
            section: "other",
            heading: false,
            itemNo: null,
          });
        else section = classifySourceLine(lines[n], section, counts);
      }
      onProgress({
        stage,
        done: Math.min(i + batch, raw.length),
        total: raw.length,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  }
  signal.throwIfAborted();
  onProgress({ stage: 2, done: raw.length, total: raw.length });
  let response: Response;
  try {
    response = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        analysisInputSchema.parse({ id: source.id, text: source.text, lines }),
      ),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AnalysisClientError("network", [
      "本机分析服务没有响应，原文已保留；已发出的调用可能仍计次",
    ]);
  }
  let data: AnalysisResponse;
  try {
    data = await response.json();
  } catch {
    throw new AnalysisClientError("network", [
      "本机分析服务返回格式不正确，原文已保留",
    ]);
  }
  if (!data.ok) {
    const kind = ["check", "quota", "network", "config"].includes(data.kind)
      ? data.kind
      : "network";
    throw new AnalysisClientError(
      kind,
      Array.isArray(data.reasons)
        ? data.reasons.filter((r) => typeof r === "string")
        : ["本次分析没有完成，原文已保留"],
    );
  }
  return reportContentSchema.parse(data.content);
}
