import "server-only";
import { z } from "zod";
import {
  answerInputSchema,
  modelAnswerSchema,
  type AnswerResponse,
} from "../domain/answer.ts";
import type { AnalysisFailureKind } from "../domain/analysis.ts";
import { checkInvite } from "./invite.ts";
import { LedgerError } from "./ledger.ts";
import { estimateCost } from "./pricing.ts";
import { buildQuestionMessages } from "./question-prompt.ts";
import { readJsonStream } from "./json-stream.ts";
import { trialCommand, type TrialOptions } from "./trial-analysis.ts";
import type { TrialConfig } from "./trial-config.ts";
import { createRedisTrialStore } from "./trial-redis.ts";
import {
  QUESTION_CALL_RESERVE,
  QUESTION_MAX_INPUT_TOKENS,
  QUESTION_MAX_OUTPUT_TOKENS,
  PER_CODE_QUESTIONS,
  PER_CODE_QUESTION_CALLS,
  TRIAL_MAX_COST_MICRO_CNY,
  requireTrialOk,
  trialStorageError,
  type TrialReceipt,
  type TrialReply,
} from "./trial-store.ts";
const envelopeSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z.unknown().optional(),
});
const usageSchema = z.object({
  prompt_tokens: z.number().int().min(0).max(QUESTION_MAX_INPUT_TOKENS),
  completion_tokens: z.number().int().min(0).max(QUESTION_MAX_OUTPUT_TOKENS),
});
class AnswerCheckError extends Error {}
function failure(kind: AnalysisFailureKind, reason: string): AnswerResponse {
  return { ok: false, kind, reasons: [reason] };
}
export function remainingQuestions(reply: TrialReply) {
  return Math.max(
    0,
    Math.min(
      PER_CODE_QUESTIONS - reply[5],
      PER_CODE_QUESTION_CALLS - reply[6],
      Math.floor((TRIAL_MAX_COST_MICRO_CNY - reply[1]) / QUESTION_CALL_RESERVE),
    ),
  );
}
export function createAnswerService(
  config: TrialConfig,
  options: TrialOptions = {},
) {
  const store =
    options.store ?? createRedisTrialStore(config, { fetch: options.fetch });
  const send = options.fetch ?? globalThis.fetch;
  return {
    async answer(
      input: unknown,
      code: string | null,
      signal?: AbortSignal,
    ): Promise<AnswerResponse> {
      const hash = checkInvite(code, config.hashes);
      if (!hash) return failure("config", "邀请码缺失或不对，请检查后重试。");
      const parsed = answerInputSchema.safeParse(input);
      if (!parsed.success)
        return failure("check", "提问内容不完整或超限，请检查后重试。");
      let messages: ReturnType<typeof buildQuestionMessages>;
      try {
        messages = buildQuestionMessages(parsed.data);
      } catch {
        return failure("check", "原文太长，暂时无法提问");
      }
      const id = crypto.randomUUID();
      let reserved = false,
        settled = false;
      let answer: z.infer<typeof modelAnswerSchema> | null = null;
      let result = failure("network", "没有拿到解答，这次不扣次数。");
      const receipt: TrialReceipt = {
        result: "network",
        inputTokens: null,
        outputTokens: null,
        estimatedCostMicro: QUESTION_CALL_RESERVE,
        elapsedMs: 0,
      };
      try {
        signal?.throwIfAborted();
        requireTrialOk(
          await store.run(trialCommand("question-reserve", hash, id, id)),
        );
        reserved = true;
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 45000);
        const requestSignal = signal
          ? AbortSignal.any([signal, timeout])
          : timeout;
        const started = performance.now();
        try {
          requestSignal.throwIfAborted();
          const response = await send(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages,
              response_format: { type: "json_object" },
              thinking: { type: "disabled" },
              max_tokens: QUESTION_MAX_OUTPUT_TOKENS,
              temperature: 0.2,
              stream: false,
            }),
            redirect: "error",
            signal: requestSignal,
          });
          if (!response.ok || response.redirected) {
            await response.body?.cancel();
            throw new Error("model unavailable");
          }
          const data = envelopeSchema.parse(
            await readJsonStream(response.body, 1024 * 1024),
          );
          requestSignal.throwIfAborted();
          const usage = usageSchema.safeParse(data.usage);
          if (usage.success) {
            receipt.inputTokens = usage.data.prompt_tokens;
            receipt.outputTokens = usage.data.completion_tokens;
            receipt.estimatedCostMicro = Math.round(
              estimateCost(receipt.inputTokens, receipt.outputTokens) *
                1_000_000,
            );
          }
          const content = data.choices[0].message.content;
          if (
            [config.apiKey, config.redisToken].some(
              (secret) => secret && content.includes(secret),
            )
          )
            throw new AnswerCheckError();
          answer = modelAnswerSchema.parse(JSON.parse(content));
          if (
            [config.apiKey, config.redisToken].some(
              (secret) => secret && answer!.answer.includes(secret),
            )
          )
            throw new AnswerCheckError();
          receipt.result = "ok";
        } catch (cause) {
          answer = null;
          const check =
            cause instanceof SyntaxError ||
            cause instanceof z.ZodError ||
            cause instanceof AnswerCheckError;
          receipt.result = check
            ? "check_failed"
            : timeout.aborted
              ? "timeout"
              : "network";
          if (!check) {
            receipt.inputTokens = null;
            receipt.outputTokens = null;
            receipt.estimatedCostMicro = QUESTION_CALL_RESERVE;
          }
          result = failure(
            check ? "check" : "network",
            check
              ? "解答未通过检查，这次不扣次数，请重试。"
              : "没有拿到解答，这次不扣次数。",
          );
        }
        receipt.elapsedMs = Math.min(
          3_600_000,
          Math.max(0, Math.round(performance.now() - started)),
        );
        requireTrialOk(
          await store.run(
            trialCommand("question-settle", hash, id, id, { receipt }),
          ),
        );
        settled = true;
      } catch (cause) {
        answer = null;
        result =
          cause instanceof LedgerError
            ? failure(cause.kind, cause.message)
            : failure(
                signal?.aborted ? "network" : "config",
                "提问服务暂不可用，这次不扣次数，请稍后重试。",
              );
      } finally {
        if (reserved) {
          try {
            const success = !!answer && settled && !signal?.aborted;
            const finished = requireTrialOk(
              await store.run(
                trialCommand("question-finish", hash, id, id, { success }),
              ),
            );
            if (success && answer)
              result = {
                ok: true,
                ...answer,
                questionsRemaining: remainingQuestions(finished),
              };
            else if (signal?.aborted)
              result = failure("network", "提问已取消，这次不扣次数。");
          } catch {
            result = failure("config", trialStorageError().message);
          }
        }
      }
      return result;
    },
  };
}
