import "server-only";
import {
  analysisInputSchema,
  type TrialAnalysisStatus,
} from "../domain/analysis.ts";
import { sourceLines } from "../domain/source.ts";
import { createAnalysisService, type InternalResult } from "./analysis.ts";
import { LedgerError, type LedgerEntry } from "./ledger.ts";
import { MODEL_ID } from "./pricing.ts";
import { checkInvite } from "./invite.ts";
import type { TrialConfig } from "./trial-config.ts";
import { createRedisTrialStore } from "./trial-redis.ts";
import {
  PER_CODE_ANALYSES,
  PER_CODE_MAX_CALLS,
  TRIAL_MAX_COST_MICRO_CNY,
  TRIAL_CALL_RESERVE,
  QUESTION_CALL_RESERVE,
  PER_CODE_QUESTIONS,
  PER_CODE_QUESTION_CALLS,
  requireTrialOk,
  trialStorageError,
  type TrialCommand,
  type TrialStore,
} from "./trial-store.ts";
export function trialCommand(
  op: TrialCommand["op"],
  code: string,
  analysisId = crypto.randomUUID(),
  id = crypto.randomUUID(),
  update: Partial<Pick<TrialCommand, "receipt" | "success" | "now">> = {},
): TrialCommand {
  const now = update.now ?? Date.now();
  return {
    op,
    code,
    analysisId,
    id,
    now,
    time: new Date(now).toISOString(),
    success: false,
    ...update,
  };
}
export interface TrialOptions {
  store?: TrialStore;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
const unavailableStatus: TrialAnalysisStatus = {
  mode: "trial",
  available: false,
  needCode: false,
  invalidCode: false,
  codeRemaining: 0,
  trialEnded: false,
  callLimitReached: false,
  questionsRemaining: 0,
  questionCallLimitReached: false,
  unavailable: false,
};
export function unavailableTrialStatus(): TrialAnalysisStatus {
  return { ...unavailableStatus, unavailable: true };
}
function failure(error: unknown): InternalResult {
  return {
    response: {
      ok: false,
      kind: error instanceof LedgerError ? error.kind : "config",
      reasons: [
        error instanceof LedgerError
          ? error.message
          : "试用分析暂不可用，原文已保留；可以继续使用模拟分析",
      ],
    },
    receipts: [],
    attempts: [],
  };
}
export function createTrialService(
  config: TrialConfig,
  options: TrialOptions = {},
) {
  const store =
    options.store ?? createRedisTrialStore(config, { fetch: options.fetch });
  return {
    async status(code: string | null): Promise<TrialAnalysisStatus> {
      const hash = checkInvite(code, config.hashes);
      if (!hash)
        return { ...unavailableStatus, needCode: !code, invalidCode: !!code };
      try {
        const [, cost, analyses, calls, , questions, questionCalls] =
          requireTrialOk(await store.run(trialCommand("status", hash)));
        const trialEnded = cost + TRIAL_CALL_RESERVE > TRIAL_MAX_COST_MICRO_CNY;
        const codeRemaining = Math.max(
          0,
          Math.min(
            PER_CODE_ANALYSES - analyses,
            PER_CODE_MAX_CALLS - calls,
            Math.floor((TRIAL_MAX_COST_MICRO_CNY - cost) / TRIAL_CALL_RESERVE),
          ),
        );
        return {
          ...unavailableStatus,
          available: codeRemaining > 0,
          codeRemaining,
          trialEnded,
          callLimitReached: calls >= PER_CODE_MAX_CALLS,
          questionsRemaining: Math.max(
            0,
            Math.min(
              PER_CODE_QUESTIONS - questions,
              PER_CODE_QUESTION_CALLS - questionCalls,
              Math.floor(
                (TRIAL_MAX_COST_MICRO_CNY - cost) / QUESTION_CALL_RESERVE,
              ),
            ),
          ),
          questionCallLimitReached: questionCalls >= PER_CODE_QUESTION_CALLS,
        };
      } catch {
        return { ...unavailableStatus, unavailable: true };
      }
    },
    async analyze(
      input: unknown,
      code: string | null,
      signal?: AbortSignal,
    ): Promise<InternalResult> {
      const hash = checkInvite(code, config.hashes);
      if (!hash)
        return failure(
          new LedgerError(
            "config",
            code
              ? "邀请码不对，请检查后重试。"
              : "请先填写邀请码；没有邀请码仍可使用模拟分析。",
          ),
        );
      const analysisId = crypto.randomUUID();
      let claimed = false,
        success = false;
      let result = failure(null);
      try {
        const source = analysisInputSchema.parse(input);
        if (
          source.text.trim().length < 40 ||
          JSON.stringify(source.lines) !==
            JSON.stringify(sourceLines(source.text))
        )
          throw new LedgerError(
            "config",
            "原文行号或分区与全文不一致，未发起调用",
          );
        signal?.throwIfAborted();
        requireTrialOk(
          await store.run(trialCommand("claim", hash, analysisId, analysisId)),
        );
        claimed = true;
        const service = createAnalysisService({
          config: async () => ({
            ...config,
            ledgerPath: "trial-injected-billing",
          }),
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
          billing: {
            withLedgerLock: async (_file, run) =>
              run({ schemaVersion: 1, entries: [] }),
            reserve: async () => {
              const id = crypto.randomUUID(),
                command = trialCommand("reserve", hash, analysisId, id);
              requireTrialOk(await store.run(command));
              const entry: LedgerEntry = {
                id,
                time: command.time,
                purpose: "smoke",
                model: MODEL_ID,
                result: "pending",
                inputTokens: null,
                outputTokens: null,
                reservedCostCny: TRIAL_CALL_RESERVE / 1_000_000,
                estimatedCostCny: TRIAL_CALL_RESERVE / 1_000_000,
                elapsedMs: null,
              };
              return entry;
            },
            settle: async (_file, _ledger, entry, update) => {
              const keepMaximum =
                update.inputTokens === null ||
                update.outputTokens === null ||
                update.result === "network" ||
                update.result === "timeout";
              const cost = keepMaximum
                ? TRIAL_CALL_RESERVE
                : Math.round(update.estimatedCostCny * 1_000_000);
              requireTrialOk(
                await store.run(
                  trialCommand("settle", hash, analysisId, entry.id, {
                    receipt: {
                      result:
                        update.result === "pending" ? "network" : update.result,
                      inputTokens: keepMaximum ? null : update.inputTokens,
                      outputTokens: keepMaximum ? null : update.outputTokens,
                      estimatedCostMicro: cost,
                      elapsedMs: update.elapsedMs ?? 0,
                    },
                  }),
                ),
              );
              Object.assign(entry, update, {
                estimatedCostCny: cost / 1_000_000,
              });
            },
          },
        });
        result = await service.analyze(source, "smoke", signal);
        success = result.response.ok && !signal?.aborted;
        if (result.response.ok && !success)
          result = {
            ...result,
            response: {
              ok: false,
              kind: "network",
              reasons: ["分析已取消，份数退还；已发出的调用仍计次。"],
            },
          };
      } catch (error) {
        result = failure(error);
      } finally {
        if (claimed)
          try {
            requireTrialOk(
              await store.run(
                trialCommand("finish", hash, analysisId, analysisId, {
                  success,
                }),
              ),
            );
          } catch {
            result = {
              ...result,
              response: {
                ok: false,
                kind: "config",
                reasons: [trialStorageError().message],
              },
            };
          }
      }
      return result;
    },
  };
}
