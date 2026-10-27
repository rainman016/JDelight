import { z } from "zod";
import type { AnalysisFailureKind } from "./analysis";
export const answerInputSchema = z.strictObject({
  jobId: z.string().min(1).max(128),
  question: z.string().trim().min(1).max(2000),
  selected: z.string().trim().min(1).max(2000),
  source: z
    .string()
    .trim()
    .min(1)
    .max(2 * 1024 * 1024),
});
export const modelAnswerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(1200),
  kind: z.enum(["common", "inference", "speculation"]),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;
export type AnswerKind = z.infer<typeof modelAnswerSchema>["kind"];
export type AnswerResponse =
  | ({ ok: true; questionsRemaining: number } & z.infer<
      typeof modelAnswerSchema
    >)
  | { ok: false; kind: AnalysisFailureKind; reasons: string[] };
