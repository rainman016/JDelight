import { z } from "zod";
import { sourceLineSchema } from "./schema.ts";
import type { ReportContent } from "./report.ts";
export const analysisInputSchema = z.strictObject({
  id: z.string().min(1).max(128),
  text: z.string().min(40).max(12000),
  lines: z.array(sourceLineSchema).min(1).max(12001),
});
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export interface LocalAnalysisStatus {
  mode?: "local";
  available: boolean;
  uiRemaining: number;
  used: number;
  maxCalls: number;
  costUsedCny: number;
  maxCostCny: number;
}
export interface TrialAnalysisStatus {
  mode: "trial";
  available: boolean;
  needCode: boolean;
  invalidCode: boolean;
  codeRemaining: number;
  trialEnded: boolean;
  callLimitReached: boolean;
  unavailable: boolean;
}
export type AnalysisStatus = LocalAnalysisStatus | TrialAnalysisStatus;
export type AnalysisFailureKind = "check" | "quota" | "network" | "config";
export type AnalysisResponse =
  | { ok: true; content: ReportContent }
  | { ok: false; kind: AnalysisFailureKind; reasons: string[] };
