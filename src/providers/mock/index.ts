import sampleText from "../../../fixtures/sample-jd.json";
import sampleReport from "../../../fixtures/sample-report.json";
import { reportContentSchema, type ReportContent } from "@/domain/report";
import type { SourceVersion } from "@/domain/schema";
import {
  classifySourceLine,
  checksOf,
  type SourceSection,
} from "@/domain/source";
import { lightSegments } from "@/domain/signals";

export const SAMPLE_JD = sampleText;
export const STAGES = ["切分段落", "识别分区", "提取技能", "检查风险"] as const;
export interface Progress {
  stage: number;
  done: number;
  total: number;
}
const placeholder = "示例分析：真实内容由分析生成";
export function reportFor(source: SourceVersion): ReportContent {
  if (source.text.replace(/\r\n|\r/g, "\n").trim() === SAMPLE_JD.trim()) {
    const fixture = structuredClone(sampleReport);
    // 复制时多出的首尾空行不改变报告内容；行号仍必须对应实际保存的原文。
    function relocate(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (
        "lineNo" in value &&
        "quote" in value &&
        typeof value.quote === "string"
      ) {
        const line = source.lines.find((line) =>
          line.text.includes(value.quote as string),
        );
        if (line) value.lineNo = line.lineNo;
      }
      Object.values(value).forEach(relocate);
    }
    relocate(fixture);
    return reportContentSchema.parse({
      ...fixture,
      sourceVersionId: source.id,
    });
  }
  // gist / focus 按契约必须有出处；只指向输入上下文，不编造岗位判断。
  const line = source.lines.find((l) => l.text.trim())!;
  const citations = [{ lineNo: line.lineNo, quote: line.text }];
  const common = (id: string) => ({
    id,
    text: placeholder,
    kind: "common" as const,
    citations: [],
  });
  return {
    schemaVersion: "report-1",
    sourceVersionId: source.id,
    origin: "mock",
    ruleVersion: "rules-1",
    header: {
      shown: source.lines
        .filter(
          (l) =>
            !l.heading &&
            l.text.trim() &&
            (l.section === "must" ||
              /学历|薪资|试用期|年.*经验|天.?周/.test(l.text)),
        )
        .map((l) => ({
          id: `condition-${l.lineNo}`,
          text: l.text,
          citations: [{ lineNo: l.lineNo, quote: l.text }],
        })),
      missing: [],
    },
    focus: {
      gist: {
        id: "placeholder-gist",
        text: placeholder,
        kind: "inference",
        citations,
      },
      items: [0, 1, 2].map((i) => ({
        id: `placeholder-focus-${i}`,
        text: placeholder,
        kind: "speculation",
        basis: "仅演示报告结构；出处指向本次输入上下文，未对岗位作实际判断。",
        citations,
      })),
    },
    sections: [
      {
        key: "positioning",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-positioning",
            type: "paragraph",
            claims: [common("placeholder-positioning-claim")],
          },
        ],
      },
      {
        key: "thresholds",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-thresholds",
            type: "paragraph",
            claims: [common("placeholder-thresholds-claim")],
          },
        ],
      },
      {
        key: "implicit",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-implicit",
            type: "paragraph",
            claims: [common("placeholder-implicit-claim")],
          },
        ],
      },
      {
        key: "capabilities",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-capabilities",
            type: "capability",
            name: placeholder,
            importance: "medium",
            meaning: [common("placeholder-capabilities-claim")],
          },
        ],
      },
      {
        key: "scenarios",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-scenarios",
            type: "paragraph",
            claims: [common("placeholder-scenarios-claim")],
          },
        ],
      },
      {
        key: "preparation",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-preparation",
            type: "paragraph",
            claims: [common("placeholder-preparation-claim")],
          },
        ],
      },
      {
        key: "toConfirm",
        status: "filled",
        blocks: [
          {
            blockId: "placeholder-question",
            type: "question",
            question: placeholder,
            why: "这是一份结构示例，未生成实际提问建议。",
            citations: [],
          },
        ],
      },
    ],
  };
}
/** 只在处理批次后让出一帧；每个计数都对应实际的行工作，不设等待下限。 */
export async function analyze(
  source: SourceVersion,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<ReportContent> {
  const rawLines = source.text.split(/\r\n|\n|\r/);
  const lines: SourceVersion["lines"] = [];
  const total = rawLines.length;
  const counts = { meta: 0, duty: 0, must: 0, bonus: 0, other: 0 };
  let section: SourceSection = "meta";
  const signals = new Map<number, ReturnType<typeof lightSegments>>();
  const risks: number[] = [];
  const work = [
    (i: number) => {
      lines.push({
        lineNo: i + 1,
        text: rawLines[i],
        section: "other",
        heading: false,
        itemNo: null,
      });
    },
    (i: number) => {
      section = classifySourceLine(lines[i], section, counts);
    },
    (i: number) => {
      signals.set(i, lightSegments(lines[i].text));
    },
    (i: number) => {
      if (signals.get(i)?.some((s) => s.kind === "risk")) risks.push(i + 1);
    },
  ];
  const batch = Math.max(1, Math.ceil(total / 30));
  for (let stage = 0; stage < work.length; stage++) {
    onProgress({ stage, done: 0, total });
    for (let i = 0; i < total; i += batch) {
      signal.throwIfAborted();
      for (let n = i; n < Math.min(i + batch, total); n++) work[stage](n);
      onProgress({ stage, done: Math.min(i + batch, total), total });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  }
  signal.throwIfAborted();
  checksOf(lines);
  return reportFor({ ...source, lines });
}
export function invalidDemoReport(content: ReportContent): unknown {
  const invalid = structuredClone(content);
  invalid.focus.items[0].citations[0].quote = "这段文字不在已确认的原文里";
  const requirement = invalid.sections
    .flatMap((s) => s.blocks)
    .find((b) => b.type === "requirement" && b.strength === "preferred");
  if (requirement?.type === "requirement") requirement.strength = "required";
  return invalid;
}
