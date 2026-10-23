import { z } from "zod";
import { kindSchema, reportContentSchema } from "./report.ts";
const id = z.string().min(1);
const iso = z.iso.datetime();
export const markSchema = z.enum(["preparing", "interviewed", "dropped"]);
export type Mark = z.infer<typeof markSchema>;
export const MARKS = {
  preparing: "准备中",
  interviewed: "已面试",
  dropped: "已放弃",
} as const;
export const sourceLineSchema = z.strictObject({
  lineNo: z.number().int().positive(),
  text: z.string(),
  section: z.enum(["meta", "duty", "must", "bonus", "other"]),
  heading: z.boolean(),
  itemNo: z.number().int().positive().nullable(),
});
export const sourceVersionSchema = z.strictObject({
  id,
  jobId: id,
  no: z.number().int().positive(),
  text: z.string().min(1),
  lines: z.array(sourceLineSchema).min(1),
  confirmedAt: iso,
});
export type SourceVersion = z.infer<typeof sourceVersionSchema>;
export const jobErrorSchema = z.strictObject({
  kind: z.enum(["check", "quota", "network", "save"]),
  reasons: z.array(z.string()),
});
export const jobSchema = z.strictObject({
  id,
  title: z.string(),
  company: z.string(),
  place: z.string(),
  mark: markSchema,
  note: z.string().refine((s) => Array.from(s).length <= 60, "备注最多 60 字"),
  status: z.enum(["saved", "analyzing", "failed", "ready"]),
  currentSourceVersionId: id,
  currentReportVersionId: id.nullable(),
  lastError: jobErrorSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
  lastViewedAt: iso,
});
export type Job = z.infer<typeof jobSchema>;
export const anchorSchema = z
  .strictObject({
    blockId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    exact: z.string(),
    prefix: z.string(),
    suffix: z.string(),
    reportVersionId: id,
    sourceVersionId: id,
    offsetUnit: z.literal("utf16"),
  })
  .refine(
    (anchor) =>
      anchor.end > anchor.start &&
      anchor.end - anchor.start === anchor.exact.length &&
      !!anchor.exact.trim(),
    "选中文字范围不完整",
  );
export const supplementSnapshotSchema = z.strictObject({
  supplementId: id,
  question: z.string(),
  answer: z.string(),
  answerKind: kindSchema,
  anchor: anchorSchema,
  addedInVersion: z.number().int().positive(),
});
export type SupplementSnapshot = z.infer<typeof supplementSnapshotSchema>;
export const reportVersionSchema = z.strictObject({
  id,
  jobId: id,
  sourceVersionId: id,
  no: z.number().int().positive(),
  parentId: id.nullable(),
  content: reportContentSchema,
  supplements: z.array(supplementSnapshotSchema),
  change: z.strictObject({
    kind: z.enum(["base", "add", "edit", "withdraw"]),
    supplementId: id.optional(),
    summary: z.string(),
  }),
  createdAt: iso,
});
export type ReportVersion = z.infer<typeof reportVersionSchema>;
export const supplementSchema = z.strictObject({
  id,
  jobId: id,
  question: z.string(),
  answer: z.string(),
  answerKind: kindSchema,
  anchor: anchorSchema,
  status: z.enum(["unanswered", "answered", "added", "withdrawn"]),
  addedInVersion: z.number().int().positive().nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type Supplement = z.infer<typeof supplementSchema>;
