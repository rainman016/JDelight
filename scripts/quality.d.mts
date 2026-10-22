import type {
  createAnalysisService,
  InternalResult,
} from "../src/server/analysis.ts";

export function runQuality(
  values: { jd?: string; out?: string },
  service?: Pick<ReturnType<typeof createAnalysisService>, "analyze">,
): Promise<{ run: string; result: InternalResult }>;
