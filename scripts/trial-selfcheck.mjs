import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readRedisConfig } from "../src/server/trial-config.ts";
import { createRedisTrialStore, trialKeys } from "../src/server/trial-redis.ts";
import { trialCommand } from "../src/server/trial-analysis.ts";
import {
  TRIAL_CALL_RESERVE,
  TRIAL_MAX_COST_MICRO_CNY,
  requireTrialOk,
  trialStorageError,
} from "../src/server/trial-store.ts";
export async function deleteSelfcheckKeys(
  config,
  prefix,
  send = globalThis.fetch,
) {
  if (!/^\{jdelight-trial-selfcheck-[a-f0-9-]{36}\}$/.test(prefix))
    throw trialStorageError();
  const response = await send(config.redisUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.redisToken}`,
    },
    body: JSON.stringify(["DEL", ...trialKeys(prefix)]),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || response.redirected) throw trialStorageError();
  const data = await response.json();
  if (
    Object.keys(data).length !== 1 ||
    !Number.isInteger(data.result) ||
    data.result < 0 ||
    data.result > 4
  )
    throw trialStorageError();
}
export async function runTrialSelfcheck(makeStore, cleanup) {
  const prefix = `{jdelight-trial-selfcheck-${crypto.randomUUID()}}`;
  const store = makeStore(prefix);
  const code = "f".repeat(64),
    analysisId = crypto.randomUUID(),
    id = crypto.randomUUID();
  const check = (ok) => {
    if (!ok) throw new Error("自检未通过");
  };
  try {
    requireTrialOk(
      await store.run(trialCommand("claim", code, analysisId, analysisId)),
    );
    const reserved = requireTrialOk(
      await store.run(trialCommand("reserve", code, analysisId, id)),
    );
    check(reserved[1] === TRIAL_CALL_RESERVE);
    const settled = requireTrialOk(
      await store.run(
        trialCommand("settle", code, analysisId, id, {
          receipt: {
            result: "ok",
            inputTokens: 100,
            outputTokens: 100,
            estimatedCostMicro: 1000,
            elapsedMs: 1,
          },
        }),
      ),
    );
    check(settled[1] === 1000);
    const finished = requireTrialOk(
      await store.run(
        trialCommand("finish", code, analysisId, analysisId, {
          success: false,
        }),
      ),
    );
    check(finished[2] === 0 && finished[3] === 1);
    const pool = Array.from({ length: 20 }, (_, i) => ({
      code: createHash("sha256").update(`selfcheck-${i}`).digest("hex"),
      job: crypto.randomUUID(),
    }));
    for (const item of pool)
      requireTrialOk(
        await store.run(trialCommand("claim", item.code, item.job, item.job)),
      );
    let denied = false,
      reservations = 0;
    for (let round = 0; round < 8 && !denied; round++) {
      const replies = await Promise.all(
        pool.map((item) =>
          store.run(trialCommand("reserve", item.code, item.job)),
        ),
      );
      for (const r of replies) {
        check(r[1] <= TRIAL_MAX_COST_MICRO_CNY && r[2] <= 15 && r[3] <= 40);
        if (r[0] === "total") denied = true;
        else {
          requireTrialOk(r);
          reservations++;
        }
      }
    }
    check(denied && reservations >= 20);
    const last = await store.run(
      trialCommand("reserve", pool[0].code, pool[0].job),
    );
    check(
      last[0] === "total" &&
        last[1] + TRIAL_CALL_RESERVE > TRIAL_MAX_COST_MICRO_CNY,
    );
    return { passed: true, reservations };
  } finally {
    await cleanup(prefix);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const config = readRedisConfig(process.env);
    if (!config) throw trialStorageError();
    const result = await runTrialSelfcheck(
      (prefix) => createRedisTrialStore(config, { prefix }),
      (prefix) => deleteSelfcheckKeys(config, prefix),
    );
    console.log(
      `试用存储自检通过：并发 20 次预留与超额拒绝已验证，测试键已删除（${result.reservations} 次成功预留）。`,
    );
  } catch {
    console.error(
      "试用存储自检未通过；未调用模型。请在控制台检查测试前缀及存储状态。",
    );
    process.exitCode = 1;
  }
}
