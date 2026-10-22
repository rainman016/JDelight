import { z } from "zod";
import type { SourceVersion } from "./schema";

const id = z.string().min(1);
export const citationSchema = z.strictObject({
  lineNo: z.number().int().positive(),
  quote: z.string().min(1),
});
const citations = z.array(citationSchema);
export const kindSchema = z.enum([
  "source",
  "inference",
  "speculation",
  "common",
]);
export const claimSchema = z.strictObject({
  id,
  text: z.string().min(1),
  kind: kindSchema,
  citations,
});
export const conditionSchema = z.strictObject({
  id,
  text: z.string().min(1),
  citations,
});
export const focusItemSchema = z.strictObject({
  id,
  text: z.string().min(1),
  kind: z.enum(["inference", "speculation"]),
  basis: z.string().min(1),
  citations,
});
export const blockSchema = z.discriminatedUnion("type", [
  z.strictObject({
    blockId: id,
    type: z.literal("paragraph"),
    claims: z.array(claimSchema).min(1),
  }),
  z.strictObject({
    blockId: id,
    type: z.literal("requirement"),
    phrase: z.string().min(1),
    strength: z.enum(["required", "preferred", "listed", "not_stated"]),
    degree: z.string(),
    note: claimSchema,
    citations,
  }),
  z.strictObject({
    blockId: id,
    type: z.literal("capability"),
    name: z.string().min(1),
    importance: z.enum(["high", "medium"]),
    meaning: z.array(claimSchema).min(1),
  }),
  z.strictObject({
    blockId: id,
    type: z.literal("scenario"),
    scene: z.string().min(1),
    product: claimSchema,
    difficulty: claimSchema,
  }),
  z.strictObject({ blockId: id, type: z.literal("probe"), claim: claimSchema }),
  z.strictObject({
    blockId: id,
    type: z.literal("question"),
    question: z.string().min(1),
    why: z.string().min(1),
    citations,
  }),
]);
export const SECTION_KEYS = [
  "positioning",
  "thresholds",
  "implicit",
  "capabilities",
  "scenarios",
  "preparation",
  "toConfirm",
] as const;
const allowed = {
  positioning: ["paragraph"],
  thresholds: ["requirement", "paragraph"],
  implicit: ["paragraph"],
  capabilities: ["capability"],
  scenarios: ["scenario", "paragraph"],
  preparation: ["paragraph", "probe"],
  toConfirm: ["question"],
} as const;
export const sectionSchema = z.strictObject({
  key: z.enum(SECTION_KEYS),
  status: z.enum(["filled", "not_in_source"]),
  blocks: z.array(blockSchema),
});
export const reportContentSchema = z.strictObject({
  schemaVersion: z.literal("report-1"),
  sourceVersionId: id,
  origin: z.enum(["mock", "model"]),
  ruleVersion: id,
  header: z.strictObject({
    shown: z.array(conditionSchema),
    missing: z.array(z.string()),
  }),
  focus: z.strictObject({
    gist: claimSchema,
    items: z.array(focusItemSchema).min(3).max(5),
  }),
  sections: z.array(sectionSchema).length(7),
});
export type Citation = z.infer<typeof citationSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type FocusItem = z.infer<typeof focusItemSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type ReportContent = z.infer<typeof reportContentSchema>;
export interface ReportIssue {
  code: `V${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  message: string;
}
export class ReportCheckError extends Error {
  constructor(public readonly issues: ReportIssue[]) {
    super(issues.map((i) => i.message).join("；"));
    this.name = "ReportCheckError";
  }
}
export function validateReport(
  input: unknown,
  source: SourceVersion,
): ReportContent {
  const parsed = reportContentSchema.safeParse(input);
  if (!parsed.success)
    throw new ReportCheckError(
      parsed.error.issues.map((issue) => ({
        code: issue.code === "unrecognized_keys" ? "V7" : "V1",
        message:
          issue.code === "unrecognized_keys"
            ? "报告含未允许的字段（包括分数类字段），没有展示"
            : "报告结构不完整或字段不合法，没有展示",
      })),
    );
  const report = parsed.data;
  const issues: ReportIssue[] = [];
  const add = (code: ReportIssue["code"], message: string) =>
    issues.push({ code, message });
  if (report.sourceVersionId !== source.id)
    add("V1", "报告对应的原文版本不一致，没有展示");
  const ids = new Set<string>();
  function unique(value: string) {
    if (ids.has(value)) add("V1", "报告中的稳定编号重复，没有展示");
    ids.add(value);
  }
  const checkCitations = (refs: Citation[], required = false) => {
    if (required && !refs.length) add("V3", "有判断缺少原文出处，没有展示");
    for (const ref of refs) {
      const line = source.lines.find((l) => l.lineNo === ref.lineNo);
      if (!line || !ref.quote.trim() || !line.text.includes(ref.quote))
        add("V2", `第 ${ref.lineNo} 行的引用和原文对不上`);
    }
  };
  const claim = (c: Claim) => {
    unique(c.id);
    checkCitations(c.citations, c.kind === "source" || c.kind === "inference");
  };
  report.header.shown.forEach((c) => {
    unique(c.id);
    checkCitations(c.citations, true);
  });
  claim(report.focus.gist);
  if (report.focus.gist.kind !== "inference")
    add("V5", "一句话解读必须标为推断，没有展示");
  report.focus.items.forEach((c) => {
    unique(c.id);
    checkCitations(c.citations, true);
  });
  report.sections.forEach((section, i) => {
    if (section.key !== SECTION_KEYS[i])
      add("V1", "报告章节不齐全或顺序不正确，没有展示");
    if (section.status === "not_in_source" && section.blocks.length)
      add("V1", "原文未体现的章节不应有内容，没有展示");
    if (section.status === "filled" && !section.blocks.length)
      add("V1", "报告章节内容为空，没有展示");
    for (const block of section.blocks) {
      unique(block.blockId);
      if (!(allowed[section.key] as readonly string[]).includes(block.type))
        add("V1", "报告章节包含不允许的内容类型，没有展示");
      switch (block.type) {
        case "paragraph":
          block.claims.forEach(claim);
          break;
        case "requirement": {
          claim(block.note);
          checkCitations(block.citations, true);
          const lines = block.citations
            .map((c) => source.lines.find((l) => l.lineNo === c.lineNo))
            .filter((l) => l !== undefined);
          if (
            block.strength === "required" &&
            lines.some((line) => {
              if (line.section === "bonus") return true;
              const clauses = line.text
                .split(/[，,；;。！？]/)
                .filter((clause) => clause.includes(block.phrase));
              return (clauses.length ? clauses : [line.text]).some((clause) =>
                /优先|加分/.test(clause),
              );
            })
          )
            add("V4", `“${block.phrase}”所在的优先或加分条件被写成了必备`);
          if (!block.citations.some((c) => c.quote.includes(block.phrase)))
            add("V6", `要求“${block.phrase}”在引用行原文里找不到`);
          break;
        }
        case "capability":
          block.meaning.forEach(claim);
          break;
        case "scenario":
          claim(block.product);
          claim(block.difficulty);
          break;
        case "probe":
          claim(block.claim);
          if (block.claim.kind !== "speculation")
            add("V5", "面试可能追问必须标为推测，没有展示");
          break;
        case "question":
          checkCitations(block.citations);
          break;
      }
    }
  });
  if (issues.length) throw new ReportCheckError(issues);
  return report;
}
