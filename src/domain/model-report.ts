import { z } from "zod";
import {
  claimSchema,
  conditionSchema,
  focusItemSchema,
  reportContentSchema,
  blockSchema,
  type ReportContent,
} from "./report.ts";
const claim = claimSchema.omit({ id: true });
const block = z.discriminatedUnion("type", [
  blockSchema.options[0]
    .omit({ blockId: true })
    .extend({ claims: z.array(claim).min(1) }),
  blockSchema.options[1].omit({ blockId: true }).extend({ note: claim }),
  blockSchema.options[2]
    .omit({ blockId: true })
    .extend({ meaning: z.array(claim).min(1) }),
  blockSchema.options[3]
    .omit({ blockId: true })
    .extend({ product: claim, difficulty: claim }),
  blockSchema.options[4].omit({ blockId: true }).extend({ claim }),
  blockSchema.options[5].omit({ blockId: true }),
]);
export const modelReportSchema = reportContentSchema
  .omit({
    schemaVersion: true,
    sourceVersionId: true,
    origin: true,
    ruleVersion: true,
  })
  .extend({
    header: z.strictObject({
      shown: z.array(conditionSchema.omit({ id: true })),
      missing: z.array(z.string()),
    }),
    focus: z.strictObject({
      gist: claim,
      items: z
        .array(focusItemSchema.omit({ id: true }))
        .min(3)
        .max(5),
    }),
    sections: z
      .array(
        reportContentSchema.shape.sections.element.extend({
          blocks: z.array(block),
        }),
      )
      .length(7),
  });
export function completeModelReport(
  input: unknown,
  sourceVersionId: string,
): ReportContent {
  const parsed = modelReportSchema.parse(input);
  function fill(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(fill);
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, fill(child)]),
    );
    if ("text" in result && "citations" in result)
      result.id = crypto.randomUUID();
    if ("type" in result) result.blockId = crypto.randomUUID();
    return result;
  }
  return reportContentSchema.parse({
    ...(fill(parsed) as object),
    schemaVersion: "report-1",
    sourceVersionId,
    origin: "model",
    ruleVersion: "prompt-1",
  });
}
