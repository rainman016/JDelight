import "server-only";
import { jsonrepair } from "jsonrepair";
import { ZodError } from "zod";
import {
  analysisInputSchema,
  type AnalysisResponse,
  type LocalAnalysisStatus,
} from "../domain/analysis.ts";
import {
  clearUnsupportedDegrees,
  completeModelReport,
} from "../domain/model-report.ts";
import { ReportCheckError, validateReport } from "../domain/report.ts";
import { sourceLines } from "../domain/source.ts";
import { readConfig, type ServerConfig } from "./config.ts";
import { buildMessages } from "./prompt.ts";
import { PROMPT_VERSION } from "./rules.ts";
import {
  remainingUiCalls,
  LedgerError,
  readLedger,
  reserve,
  settle,
  summarize,
  withLedgerLock,
  type LedgerEntry,
  type Outcome,
  type Purpose,
} from "./ledger.ts";
import {
  MAX_CALLS,
  MAX_COST_CNY,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  TIMEOUT_MS,
  estimateCost,
} from "./pricing.ts";
export type Receipt = Pick<
  LedgerEntry,
  | "id"
  | "result"
  | "inputTokens"
  | "outputTokens"
  | "estimatedCostCny"
  | "elapsedMs"
>;
export interface InternalResult {
  response: AnalysisResponse;
  receipts: Receipt[];
  attempts: AttemptDiagnostic[];
}
export interface AttemptDiagnostic {
  attempt: number;
  finishReason: string | null;
  repaired?: boolean;
  clearedDegrees?: number;
  reasons?: string[];
  rejected?:
    { format: "json"; content: unknown } | { format: "text"; content: string };
  omittedReason?: string;
}
interface Options {
  config?: () => Promise<ServerConfig | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  billing?: {
    withLedgerLock: typeof withLedgerLock;
    reserve: typeof reserve;
    settle: typeof settle;
  };
}
const message = {
  ok: false,
  kind: "config",
  reasons: ["本机配置未就绪，核对四项变量、指定型号和仓库外的可读账本"],
} as const;
class FormatFailure extends Error {}
function cleanReasons(reasons: string[], secret: string) {
  return reasons
    .map((reason) => reason.split(secret).join("[已隐藏]"))
    .slice(0, 12);
}
function receipt(entry: LedgerEntry): Receipt {
  return {
    id: entry.id,
    result: entry.result,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    estimatedCostCny: entry.estimatedCostCny,
    elapsedMs: entry.elapsedMs,
  };
}
export function createAnalysisService(options: Options = {}) {
  const configured = options.config ?? readConfig;
  const send = options.fetch ?? globalThis.fetch;
  const billing = options.billing ?? { withLedgerLock, reserve, settle };
  return {
    async status(): Promise<LocalAnalysisStatus> {
      const base = {
        available: false,
        uiRemaining: 0,
        used: 0,
        maxCalls: MAX_CALLS,
        costUsedCny: 0,
        maxCostCny: MAX_COST_CNY,
      };
      const config = await configured().catch(() => null);
      if (!config) return base;
      try {
        const ledger = await readLedger(config.ledgerPath);
        const summary = summarize(ledger);
        const uiRemaining = remainingUiCalls(ledger);
        return { ...base, ...summary, uiRemaining, available: uiRemaining > 0 };
      } catch {
        return { ...base, used: MAX_CALLS, costUsedCny: MAX_COST_CNY };
      }
    },
    async analyze(
      input: unknown,
      purpose: Purpose = "smoke",
      signal?: AbortSignal,
    ): Promise<InternalResult> {
      const receipts: Receipt[] = [];
      // 仅供本机质量脚本；HTTP 仍只序列化 response 和 receipts。
      const attempts: AttemptDiagnostic[] = [];
      let config: ServerConfig | null = null;
      try {
        config = await configured();
        if (!config)
          return {
            response: { ...message, reasons: [...message.reasons] },
            receipts,
            attempts,
          };
        const source = analysisInputSchema.parse(input);
        if (
          source.text.trim().length < 40 ||
          JSON.stringify(source.lines) !==
            JSON.stringify(sourceLines(source.text))
        )
          return {
            response: {
              ok: false,
              kind: "config",
              reasons: ["原文行号或分区与全文不一致，未发起调用"],
            },
            receipts,
            attempts,
          };
        const fullSource = {
          ...source,
          jobId: "server-validation",
          no: 1,
          confirmedAt: new Date().toISOString(),
        };
        const currentConfig = config;
        return await billing.withLedgerLock(
          config.ledgerPath,
          async (ledger): Promise<InternalResult> => {
            let retryReasons: string[] = [];
            for (let attempt = 0; attempt < 2; attempt++) {
              signal?.throwIfAborted();
              const messages = buildMessages(source, retryReasons);
              const timeout = AbortSignal.timeout(
                options.timeoutMs ?? TIMEOUT_MS,
              );
              const requestSignal = signal
                ? AbortSignal.any([signal, timeout])
                : timeout;
              let entry: LedgerEntry;
              try {
                entry = await billing.reserve(
                  currentConfig.ledgerPath,
                  ledger,
                  purpose,
                );
              } catch (error) {
                if (
                  !(error instanceof LedgerError) ||
                  retryReasons.length === 0
                )
                  throw error;
                return {
                  response: {
                    ok: false,
                    kind: error.kind,
                    reasons: [...retryReasons, error.message],
                  },
                  receipts,
                  attempts,
                };
              }
              const started = performance.now();
              const diagnostic: AttemptDiagnostic = {
                attempt: attempt + 1,
                finishReason: null,
              };
              attempts.push(diagnostic);
              let outcome: Outcome = "network";
              let inputTokens: number | null = null,
                outputTokens: number | null = null;
              let estimatedCostCny = entry.reservedCostCny;
              let response: AnalysisResponse = {
                ok: false,
                kind: "network",
                reasons: ["本次模型请求没有成功，原文仍在本机，可以重试"],
              };
              try {
                requestSignal.throwIfAborted();
                const result = await send(
                  `${currentConfig.baseUrl}/chat/completions`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${currentConfig.apiKey}`,
                    },
                    body: JSON.stringify({
                      model: currentConfig.model,
                      messages,
                      response_format: { type: "json_object" },
                      // DeepSeek 默认开启高强度思考；本机 90 秒 JSON 分析显式关闭。
                      // https://api-docs.deepseek.com/guides/thinking_mode/（2026-10-22）
                      thinking: { type: "disabled" },
                      max_tokens: MAX_OUTPUT_TOKENS,
                      temperature: 0.2,
                      stream: false,
                    }),
                    signal: requestSignal,
                    redirect: "error",
                  },
                );
                if (!result.ok) {
                  await result.body?.cancel();
                  throw new Error("request-failed");
                }
                // 限制返回体大小；失败内容仅经内部结果交给质量脚本。
                const data = await readResponse(result);
                const usage =
                  data && typeof data === "object" && "usage" in data
                    ? (data.usage as Record<string, unknown>)
                    : null;
                if (
                  usage &&
                  typeof usage.prompt_tokens === "number" &&
                  typeof usage.completion_tokens === "number" &&
                  Number.isInteger(usage.prompt_tokens) &&
                  Number.isInteger(usage.completion_tokens) &&
                  usage.prompt_tokens >= 0 &&
                  usage.prompt_tokens <= MAX_INPUT_TOKENS &&
                  usage.completion_tokens >= 0 &&
                  usage.completion_tokens <= MAX_OUTPUT_TOKENS
                ) {
                  inputTokens = usage.prompt_tokens;
                  outputTokens = usage.completion_tokens;
                  estimatedCostCny = estimateCost(inputTokens, outputTokens);
                }
                const choices =
                  data && typeof data === "object" && "choices" in data
                    ? (data.choices as {
                        message?: { content?: unknown };
                        finish_reason?: unknown;
                      }[])
                    : [];
                const finishReason = Array.isArray(choices)
                  ? choices[0]?.finish_reason
                  : null;
                diagnostic.finishReason =
                  typeof finishReason === "string" &&
                  !finishReason.includes(currentConfig.apiKey)
                    ? finishReason
                    : null;
                const text = Array.isArray(choices)
                  ? choices[0]?.message?.content
                  : null;
                if (typeof text !== "string") throw new FormatFailure();
                if (text.includes(currentConfig.apiKey)) {
                  diagnostic.omittedReason = "模型输出含密钥，未写入失败内容";
                  throw new FormatFailure();
                }
                let rejected: AttemptDiagnostic["rejected"] = {
                  format: "text",
                  content: text,
                };
                try {
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(text);
                  } catch {
                    parsed = JSON.parse(jsonrepair(text));
                    diagnostic.repaired = true;
                  }
                  if (JSON.stringify(parsed).includes(currentConfig.apiKey)) {
                    diagnostic.omittedReason = "模型输出含密钥，未写入失败内容";
                    throw new FormatFailure();
                  }
                  // 若结构不合法而无法补齐，仍保留已解析的 JSON 供诊断。
                  rejected = { format: "json", content: parsed };
                  const content = completeModelReport(
                    parsed,
                    source.id,
                    PROMPT_VERSION,
                  );
                  diagnostic.clearedDegrees = clearUnsupportedDegrees(content);
                  if (JSON.stringify(content).includes(currentConfig.apiKey)) {
                    diagnostic.omittedReason = "模型输出含密钥，未写入失败内容";
                    throw new FormatFailure();
                  }
                  rejected = { format: "json", content };
                  validateReport(content, fullSource);
                  outcome = "ok";
                  response = { ok: true, content };
                } catch (error) {
                  if (!diagnostic.omittedReason) diagnostic.rejected = rejected;
                  const checked = error instanceof ReportCheckError;
                  diagnostic.reasons = cleanReasons(
                    checked
                      ? error.issues.map(
                          (issue) => `${issue.code} ${issue.message}`,
                        )
                      : error instanceof ZodError
                        ? error.issues.map((issue) =>
                            issue.code === "unrecognized_keys"
                              ? "V7 报告含未允许的字段（包括分数类字段），没有展示"
                              : "V1 报告结构不完整或字段不合法，没有展示",
                          )
                        : ["格式无法解析"],
                    currentConfig.apiKey,
                  );
                  outcome = checked ? "check_failed" : "format_failed";
                  retryReasons = cleanReasons(
                    checked
                      ? [...new Set(error.issues.map((issue) => issue.message))]
                      : ["模型输出的 JSON 格式或报告结构不符合约定"],
                    currentConfig.apiKey,
                  );
                  response = {
                    ok: false,
                    kind: "check",
                    reasons: retryReasons,
                  };
                }
              } catch (error) {
                if (error instanceof FormatFailure) {
                  outcome = "format_failed";
                  diagnostic.reasons = ["格式无法解析"];
                  retryReasons = ["模型输出的 JSON 格式或报告结构不符合约定"];
                  response = {
                    ok: false,
                    kind: "check",
                    reasons: retryReasons,
                  };
                } else if (timeout.aborted && !signal?.aborted) {
                  outcome = "timeout";
                  response = {
                    ok: false,
                    kind: "network",
                    reasons: [
                      "模型请求等待 90 秒后超时，本次仍计次；原文已保留，可以重试",
                    ],
                  };
                } else if (signal?.aborted)
                  response = {
                    ok: false,
                    kind: "network",
                    reasons: ["分析已取消；已经发出的调用仍计次，原文已保留"],
                  };
              }
              if (!response.ok)
                diagnostic.reasons ??= cleanReasons(
                  response.reasons,
                  currentConfig.apiKey,
                );
              try {
                await billing.settle(currentConfig.ledgerPath, ledger, entry, {
                  result: outcome,
                  inputTokens,
                  outputTokens,
                  estimatedCostCny,
                  elapsedMs: Math.max(
                    0,
                    Math.round(performance.now() - started),
                  ),
                });
              } catch {
                receipts.push(receipt(entry));
                return {
                  response: {
                    ok: false,
                    kind: "config",
                    reasons: [
                      "账本补记失败，本次按已预留调用与最高估算费用计入，未继续请求",
                    ],
                  },
                  receipts,
                  attempts,
                };
              }
              receipts.push(receipt(entry));
              if (
                response.ok ||
                outcome === "network" ||
                outcome === "timeout" ||
                signal?.aborted ||
                attempt === 1
              )
                return { response, receipts, attempts };
            }
            return {
              response: {
                ok: false,
                kind: "check",
                reasons: ["报告没有通过检查，未展示"],
              },
              receipts,
              attempts,
            };
          },
        );
      } catch (error) {
        if (error instanceof LedgerError)
          return {
            response: { ok: false, kind: error.kind, reasons: [error.message] },
            receipts,
            attempts,
          };
        return {
          response: {
            ok: false,
            kind: signal?.aborted ? "network" : "config",
            reasons: [
              signal?.aborted
                ? "请求已取消，已发出的调用仍计次"
                : "输入或本机配置未通过检查，未发起后续调用",
            ],
          },
          receipts,
          attempts,
        };
      }
    },
  };
}
async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new FormatFailure();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 1024 * 1024) {
        await reader.cancel();
        throw new FormatFailure();
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new FormatFailure();
  }
}
export const analysisService = createAnalysisService();
