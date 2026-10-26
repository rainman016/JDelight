import "server-only";
import {
  ANALYSIS_LEASE_MS,
  PER_CODE_ANALYSES,
  PER_CODE_MAX_CALLS,
  TRIAL_MAX_COST_MICRO_CNY,
  TRIAL_CALL_RESERVE,
  trialCommandSchema,
  trialReplySchema,
  type TrialStore,
  type TrialReceipt,
  type TrialReply,
} from "./trial-store.ts";
// 仅测试显式注入；生产代码没有回落到此实现的分支。
export function createMemoryTrialStore(
  initial: {
    cost?: number;
    code?: string;
    analyses?: number;
    calls?: number;
  } = {},
) {
  let cost = initial.cost ?? 0;
  const counts = new Map<string, { analyses: number; calls: number }>();
  if (initial.code)
    counts.set(initial.code, {
      analyses: initial.analyses ?? 0,
      calls: initial.calls ?? 0,
    });
  const jobs = new Map<
    string,
    { code: string; status: string; expires: number }
  >();
  const reservations = new Map<
    string,
    { code: string; analysisId: string; cost: number; status: string }
  >();
  const receipts: (Omit<TrialReceipt, "result" | "elapsedMs"> & {
    id: string;
    time: string;
    codePrefix: string;
    result: TrialReceipt["result"] | "pending";
    elapsedMs: number | null;
  })[] = [];
  const store: TrialStore = {
    async run(input) {
      const p = trialCommandSchema.parse(input);
      const n = counts.get(p.code) ?? { analyses: 0, calls: 0 };
      counts.set(p.code, n);
      for (const [id, j] of jobs)
        if (j.code === p.code && j.status === "pending" && j.expires <= p.now) {
          n.analyses--;
          jobs.delete(id);
        }
      const reply = (kind: TrialReply[0], id = "") =>
        trialReplySchema.parse([kind, cost, n.analyses, n.calls, id]);
      if (p.op === "status") return reply("ok");
      const j = jobs.get(p.analysisId);
      if (p.op === "claim") {
        if (j)
          return reply(
            j.code === p.code && j.status === "pending" ? "ok" : "state",
            p.analysisId,
          );
        if (n.analyses >= PER_CODE_ANALYSES) return reply("shares");
        if (n.calls >= PER_CODE_MAX_CALLS) return reply("calls");
        if (cost + TRIAL_CALL_RESERVE > TRIAL_MAX_COST_MICRO_CNY)
          return reply("total");
        n.analyses++;
        jobs.set(p.analysisId, {
          code: p.code,
          status: "pending",
          expires: p.now + ANALYSIS_LEASE_MS,
        });
        return reply("ok", p.analysisId);
      }
      if (!j || j.code !== p.code) return reply("state");
      if (p.op === "finish") {
        if (j.status !== "pending") return reply("state");
        if (!p.success) n.analyses--;
        jobs.delete(p.analysisId);
        return reply("ok", p.analysisId);
      }
      const r = reservations.get(p.id);
      if (p.op === "reserve") {
        if (j.status !== "pending") return reply("state");
        if (r)
          return reply(
            r.code === p.code && r.analysisId === p.analysisId ? "ok" : "state",
            p.id,
          );
        if (n.calls >= PER_CODE_MAX_CALLS) return reply("calls");
        if (cost + TRIAL_CALL_RESERVE > TRIAL_MAX_COST_MICRO_CNY)
          return reply("total");
        cost += TRIAL_CALL_RESERVE;
        n.calls++;
        reservations.set(p.id, {
          code: p.code,
          analysisId: p.analysisId,
          cost: TRIAL_CALL_RESERVE,
          status: "pending",
        });
        receipts.unshift({
          id: p.id,
          time: p.time,
          codePrefix: p.code.slice(0, 8),
          result: "pending",
          estimatedCostMicro: TRIAL_CALL_RESERVE,
          inputTokens: null,
          outputTokens: null,
          elapsedMs: null,
        });
        receipts.length = Math.min(1000, receipts.length);
        return reply("ok", p.id);
      }
      if (
        !r ||
        r.code !== p.code ||
        r.analysisId !== p.analysisId ||
        !p.receipt
      )
        return reply("state");
      if (r.status === "settled") return reply("ok", p.id);
      if (
        p.receipt.estimatedCostMicro > r.cost ||
        cost < r.cost - p.receipt.estimatedCostMicro
      )
        return reply("state");
      cost -= r.cost - p.receipt.estimatedCostMicro;
      r.cost = p.receipt.estimatedCostMicro;
      r.status = "settled";
      const row = {
        ...p.receipt,
        id: p.id,
        time: p.time,
        codePrefix: p.code.slice(0, 8),
      };
      const index = receipts.findIndex((v) => v.id === p.id);
      if (index >= 0) receipts[index] = row;
      else receipts.unshift(row);
      receipts.length = Math.min(1000, receipts.length);
      return reply("ok", p.id);
    },
  };
  return {
    ...store,
    inspect: () =>
      structuredClone({
        cost,
        counts: [...counts],
        receipts,
        jobs: [...jobs],
        reservations: [...reservations],
      }),
  };
}
