// @vitest-environment node
import { expect, test, vi, afterEach } from "vitest";
import { createTrialService, trialCommand } from "./server/trial-analysis";
import { createMemoryTrialStore } from "./server/trial-memory";
import { createRedisTrialStore } from "./server/trial-redis";
import {
  readTrialMode,
  readRedisConfig,
  type TrialConfig,
} from "./server/trial-config";
import { inviteHash, checkInvite } from "./server/invite";
import {
  TRIAL_LUA,
  TRIAL_CALL_RESERVE as R,
  TRIAL_MAX_COST_MICRO_CNY as MAX,
  ANALYSIS_LEASE_MS,
  requireTrialOk,
  type TrialStore,
} from "./server/trial-store";
import { createHandlers } from "./server/api";
import { createAnalysisService } from "./server/analysis";
import { BASE_URL, MODEL_ID, estimateCost } from "./server/pricing";
import { buildMessages } from "./server/prompt";
import { sourceLines } from "./domain/source";
import sample from "../fixtures/sample-jd.json";
import report from "../fixtures/sample-report.json";
const code = "ABCDE-FGHJK",
  hash = inviteHash(code)!;
const config: TrialConfig = {
  apiKey: "wo004-model-fixture",
  baseUrl: BASE_URL,
  model: MODEL_ID,
  redisUrl: "https://redis.test.invalid",
  redisToken: "wo004-test-token-never-export",
  hashes: [hash],
  allowedHosts: ["trial.test"],
};
const env = {
  EASYROUTER_API_KEY: config.apiKey,
  EASYROUTER_BASE_URL: BASE_URL,
  EASYROUTER_MODEL: MODEL_ID,
  UPSTASH_REDIS_REST_URL: config.redisUrl,
  UPSTASH_REDIS_REST_TOKEN: config.redisToken,
  JDELIGHT_INVITE_HASHES: hash,
  JDELIGHT_ALLOWED_HOSTS: "trial.test",
};
afterEach(() => vi.restoreAllMocks());
function input() {
  return { id: crypto.randomUUID(), text: sample, lines: sourceLines(sample) };
}
function modelBody(value: unknown = report): unknown {
  if (Array.isArray(value)) return value.map(modelBody);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "id",
            "blockId",
            "schemaVersion",
            "sourceVersionId",
            "origin",
            "ruleVersion",
          ].includes(key),
      )
      .map(([key, child]) => [key, modelBody(child)]),
  );
}
const reply = (
  content = JSON.stringify(modelBody()),
  usage: unknown = { prompt_tokens: 1000, completion_tokens: 500 },
) => Response.json({ choices: [{ message: { content } }], usage });
async function claim(store: TrialStore, h = hash) {
  const id = crypto.randomUUID();
  requireTrialOk(await store.run(trialCommand("claim", h, id, id)));
  return id;
}
test("Lua 全文冻结；金额、每码份数与调用数使用独立整数常量", () => {
  expect(TRIAL_LUA).toMatchSnapshot();
  expect(R).toBe(248644);
});
test("邀请码哈希规范化，常量时间比较支持哈希列表且拒绝缺失和无效码", () => {
  expect(inviteHash("abcde-fghjk")).toBe(hash);
  expect(inviteHash("abcdefghjk")).toBe(hash);
  expect(checkInvite(code, ["f".repeat(64), hash])).toBe(hash);
  for (const value of [null, "", "ABCDE-FGHJM", "00000-OOOOO", "ABCDE FGHJK"])
    expect(checkInvite(value, [hash])).toBeNull();
});
test("有效试用配置接受两组配对变量；本机没有试用配置时保留本机模式", () => {
  expect(readTrialMode(env).config).toEqual(config);
  expect(readTrialMode({})).toEqual({ enabled: false, config: null });
  expect(
    readTrialMode({
      ...env,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      KV_REST_API_URL: config.redisUrl,
      KV_REST_API_TOKEN: config.redisToken,
    }).config,
  ).toEqual(config);
  expect(
    readRedisConfig({
      KV_REST_API_URL: config.redisUrl,
      KV_REST_API_TOKEN: config.redisToken,
    }),
  ).toEqual({ redisUrl: config.redisUrl, redisToken: config.redisToken });
});
test.each([
  "EASYROUTER_API_KEY",
  "EASYROUTER_BASE_URL",
  "EASYROUTER_MODEL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "JDELIGHT_INVITE_HASHES",
  "JDELIGHT_ALLOWED_HOSTS",
])("试用缺少 %s 时不可用，不回退文件账本", (key) => {
  expect(
    readTrialMode({
      ...env,
      [key]: undefined,
      JDELIGHT_LEDGER_PATH: "unused.json",
    }),
  ).toEqual({ enabled: true, config: null });
});
test.each([
  { UPSTASH_REDIS_REST_URL: "http://redis.test.invalid" },
  { UPSTASH_REDIS_REST_URL: "https://user:pass@redis.test.invalid" },
  { UPSTASH_REDIS_REST_TOKEN: "bad\ntoken" },
  { JDELIGHT_INVITE_HASHES: "bad" },
  { JDELIGHT_ALLOWED_HOSTS: "*.test" },
  { JDELIGHT_ALLOWED_HOSTS: "https://trial.test" },
  { JDELIGHT_ALLOWED_HOSTS: "trial.test:65536" },
  { EASYROUTER_MODEL: "other" },
])("非法试用配置拒绝：%j", (changes) => {
  expect(readTrialMode({ ...env, ...changes })).toEqual({
    enabled: true,
    config: null,
  });
});
test("原子预留边界、结算差额、失败退份，金额与调用数不退", async () => {
  const store = createMemoryTrialStore({ cost: MAX - R });
  const job = await claim(store);
  const id = crypto.randomUUID();
  expect(
    requireTrialOk(await store.run(trialCommand("reserve", hash, job, id)))[1],
  ).toBe(MAX);
  expect((await store.run(trialCommand("reserve", hash, job)))[0]).toBe(
    "total",
  );
  await store.run(
    trialCommand("settle", hash, job, id, {
      receipt: {
        result: "network",
        inputTokens: null,
        outputTokens: null,
        estimatedCostMicro: R,
        elapsedMs: 1,
      },
    }),
  );
  await store.run(trialCommand("finish", hash, job, job, { success: false }));
  const status = await store.run(trialCommand("status", hash));
  expect(status.slice(1, 4)).toEqual([MAX, 0, 1]);
  const next = createMemoryTrialStore();
  const j = await claim(next),
    r = crypto.randomUUID();
  await next.run(trialCommand("reserve", hash, j, r));
  const settled = await next.run(
    trialCommand("settle", hash, j, r, {
      receipt: {
        result: "ok",
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostMicro: 110,
        elapsedMs: 1,
      },
    }),
  );
  expect(settled[1]).toBe(110);
  expect(
    (
      await next.run(
        trialCommand("settle", hash, j, r, {
          receipt: {
            result: "ok",
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostMicro: 0,
            elapsedMs: 1,
          },
        }),
      )
    )[1],
  ).toBe(110);
});
test("同一码连续 200 次占份后输入超限失败，不累积占份记录或消耗额度", async () => {
  const memory = createMemoryTrialStore();
  const run = vi.fn(memory.run),
    send = vi.fn<typeof fetch>();
  const service = createTrialService(config, { store: { run }, fetch: send });
  const text = "能力要求\n".repeat(2000);
  const source = {
    id: crypto.randomUUID(),
    text,
    lines: sourceLines(text),
  };
  expect(() => buildMessages(source)).toThrow(
    "原文与报告结构超过本次安全输入额度，未发起调用",
  );
  for (let i = 0; i < 200; i++) {
    const result = await service.analyze(source, code);
    expect(result.response).toMatchObject({
      ok: false,
      kind: "config",
    });
  }
  const operations = run.mock.calls.map(([command]) => command.op);
  expect(operations.filter((op) => op === "claim")).toHaveLength(200);
  expect(operations.filter((op) => op === "finish")).toHaveLength(200);
  expect(operations).not.toContain("reserve");
  expect(send).not.toHaveBeenCalled();
  expect(memory.inspect().jobs).toEqual([]);
  expect(memory.inspect().reservations).toEqual([]);
  expect((await memory.run(trialCommand("status", hash))).slice(1, 4)).toEqual([
    0, 0, 0,
  ]);
});

test.each([true, false])(
  "finish success=%s 删除记录；重复 finish 返回 state，不改变额度或其他占份",
  async (success) => {
    const store = createMemoryTrialStore();
    const completed = await claim(store),
      pending = await claim(store);
    await store.run(trialCommand("reserve", hash, completed));
    const expectedCounters = [R, success ? 2 : 1, 1];
    const finished = await store.run(
      trialCommand("finish", hash, completed, completed, { success }),
    );
    expect(finished[0]).toBe("ok");
    expect(finished.slice(1, 4)).toEqual(expectedCounters);
    expect(store.inspect().jobs).toEqual([
      [pending, expect.objectContaining({ code: hash, status: "pending" })],
    ]);
    for (const repeatedSuccess of [false, true]) {
      const repeated = await store.run(
        trialCommand("finish", hash, completed, completed, {
          success: repeatedSuccess,
        }),
      );
      expect(repeated[0]).toBe("state");
      expect(repeated.slice(1, 4)).toEqual(expectedCounters);
    }
    expect(store.inspect().jobs).toHaveLength(1);
    expect(store.inspect().jobs[0][0]).toBe(pending);
  },
);

test("第 15 份成功后第 16 次被拒；40 次调用硬上限独立于份数", async () => {
  const store = createMemoryTrialStore();
  for (let i = 0; i < 15; i++) {
    const id = await claim(store);
    await store.run(trialCommand("reserve", hash, id));
    await store.run(trialCommand("finish", hash, id, id, { success: true }));
  }
  expect((await store.run(trialCommand("claim", hash)))[0]).toBe("shares");
  const exhausted = createMemoryTrialStore({ code: hash, calls: 40 });
  expect((await exhausted.run(trialCommand("claim", hash)))[0]).toBe("calls");
  const almost = createMemoryTrialStore({ code: hash, calls: 39 });
  const job = await claim(almost);
  const results = await Promise.all([
    almost.run(trialCommand("reserve", hash, job)),
    almost.run(trialCommand("reserve", hash, job)),
  ]);
  expect(results.map((r) => r[0]).sort()).toEqual(["calls", "ok"]);
});
test("50 并发竞争最后十次预留，不超总金额、份数或调用数", async () => {
  const store = createMemoryTrialStore({ cost: MAX - R * 10 });
  const results = await Promise.all(
    Array.from({ length: 50 }, async () => {
      const j = crypto.randomUUID();
      const claimed = await store.run(trialCommand("claim", hash, j, j));
      if (claimed[0] !== "ok") return claimed[0];
      const r = await store.run(trialCommand("reserve", hash, j));
      if (r[0] !== "ok")
        await store.run(trialCommand("finish", hash, j, j, { success: false }));
      return r[0];
    }),
  );
  expect(results.filter((r) => r === "ok")).toHaveLength(10);
  const state = await store.run(trialCommand("status", hash));
  expect(state.slice(1, 4)).toEqual([MAX, 10, 10]);
});
test("假 REST EVAL 使用同一命令契约，鉴权、重定向、超时和四个同槽键正确", async () => {
  const memory = createMemoryTrialStore();
  const send = vi.fn<typeof fetch>(async (url, options) => {
    expect(url).toBe(config.redisUrl);
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toMatchObject({
      Authorization: `Bearer ${config.redisToken}`,
    });
    const args = JSON.parse(String(options?.body));
    expect(args.slice(0, 3)).toEqual(["EVAL", TRIAL_LUA, 4]);
    expect(
      args
        .slice(3, 7)
        .every((s: string) => s.startsWith("{jdelight-trial-v1}:")),
    ).toBe(true);
    return Response.json({ result: await memory.run(JSON.parse(args[7])) });
  });
  const store = createRedisTrialStore(config, { fetch: send });
  const j = await claim(store);
  await store.run(trialCommand("reserve", hash, j));
  expect((await store.run(trialCommand("status", hash))).slice(1, 4)).toEqual([
    R,
    1,
    1,
  ]);
});
test("被杀进程的过期未完成份数可恢复，预留费用与调用数保持，成功份数不重置", async () => {
  const store = createMemoryTrialStore();
  const completed = await claim(store);
  await store.run(trialCommand("reserve", hash, completed));
  await store.run(
    trialCommand("finish", hash, completed, completed, { success: true }),
  );
  const j = await claim(store);
  await store.run(trialCommand("reserve", hash, j));
  const expired = await store.run(
    trialCommand("status", hash, j, j, {
      now: Date.now() + ANALYSIS_LEASE_MS + 1,
    }),
  );
  expect(expired.slice(1, 4)).toEqual([2 * R, 1, 2]);
  expect(store.inspect().jobs).toEqual([]);
  for (const success of [false, true]) {
    const repeated = await store.run(
      trialCommand("finish", hash, j, j, { success }),
    );
    expect(repeated[0]).toBe("state");
    expect(repeated.slice(1, 4)).toEqual([2 * R, 1, 2]);
  }
});
test("自动重试仅占一份，按两次调用结算，回执无原文、报告或凭据", async () => {
  const store = createMemoryTrialStore();
  let n = 0;
  const send = vi.fn<typeof fetch>(async () =>
    ++n === 1 ? reply("not json") : reply(),
  );
  const result = await createTrialService(config, {
    store,
    fetch: send,
  }).analyze(input(), code);
  expect(result.response.ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  const state = await store.run(trialCommand("status", hash));
  expect(state.slice(2, 4)).toEqual([1, 2]);
  expect(state[1]).toBe(2 * Math.round(estimateCost(1000, 500) * 1e6));
  const receipts = store.inspect().receipts;
  expect(receipts).toHaveLength(2);
  expect(Object.keys(receipts[0]).sort()).toEqual(
    [
      "id",
      "time",
      "codePrefix",
      "result",
      "inputTokens",
      "outputTokens",
      "estimatedCostMicro",
      "elapsedMs",
    ].sort(),
  );
  for (const value of [sample, config.apiKey, config.redisToken, hash])
    expect(JSON.stringify(receipts)).not.toContain(value);
});
test.each([
  undefined,
  { prompt_tokens: -1, completion_tokens: 1 },
  { prompt_tokens: 999999, completion_tokens: 1 },
])("usage 缺失或非法按最高预留：%j", async (usage) => {
  const store = createMemoryTrialStore();
  await createTrialService(config, {
    store,
    fetch: async () =>
      reply(JSON.stringify(modelBody()), usage === undefined ? null : usage),
  }).analyze(input(), code);
  expect(store.inspect().cost).toBe(R);
});
test("失败退份；网络超时与取消仍保留最高费用和调用数", async () => {
  for (const cancel of [false, true]) {
    const store = createMemoryTrialStore();
    const ctrl = new AbortController();
    const send: typeof fetch = async (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
        if (cancel) ctrl.abort();
      });
    const result = await createTrialService(config, {
      store,
      fetch: send,
      timeoutMs: 5,
    }).analyze(input(), code, ctrl.signal);
    expect(result.response.ok).toBe(false);
    expect((await store.run(trialCommand("status", hash))).slice(1, 4)).toEqual(
      [R, 0, 1],
    );
    expect(store.inspect().jobs).toEqual([]);
  }
});
test.each([
  () => Response.json({ error: "script failed" }),
  () => new Response("bad", { status: 500 }),
  () => Response.json({ result: ["ok", -1, 0, 0, ""] }),
  () => Response.json({ result: ["ok", 0, 0, 0, "wrong"] }),
  () => Response.json({ result: "invalid" }),
  () => new Response("x".repeat(65537)),
])("存储非法返回／脚本错误不放行", async (make) => {
  const store = createRedisTrialStore(config, { fetch: async () => make() });
  const model = vi.fn<typeof fetch>();
  const result = await createTrialService(config, {
    store,
    fetch: model,
  }).analyze(input(), code);
  expect(result.response).toMatchObject({ ok: false, kind: "config" });
  expect(model).not.toHaveBeenCalled();
});
test("存储超时和拒绝重定向，错误信息不回显服务端值", async () => {
  const send: typeof fetch = async (_url, init) =>
    new Promise((_, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error(config.redisToken)),
        { once: true },
      ),
    );
  await expect(
    createRedisTrialStore(config, { fetch: send, timeoutMs: 5 }).run(
      trialCommand("status", hash),
    ),
  ).rejects.toThrow("试用记账服务暂不可用");
  const response = Response.json({ result: ["ok", 0, 0, 0, ""] });
  Object.defineProperty(response, "redirected", { value: true });
  await expect(
    createRedisTrialStore(config, { fetch: async () => response }).run(
      trialCommand("status", hash),
    ),
  ).rejects.toThrow("试用记账服务暂不可用");
});
test("状态只显示本码剩余份数和必要标记，无金额、其他码或配置；无效码不访问存储", async () => {
  const memory = createMemoryTrialStore({
    cost: MAX - R * 2,
    code: hash,
    analyses: 10,
    calls: 39,
  });
  const run = vi.fn(memory.run);
  const service = createTrialService(config, { store: { run } });
  expect(await service.status(null)).toMatchObject({
    available: false,
    needCode: true,
  });
  expect(await service.status("ABCDE-FGHJM")).toMatchObject({
    available: false,
    invalidCode: true,
  });
  expect(run).not.toHaveBeenCalled();
  const state = await service.status(code);
  expect(state).toMatchObject({ available: true, codeRemaining: 1 });
  expect(Object.keys(state).sort()).toEqual(
    [
      "mode",
      "available",
      "needCode",
      "invalidCode",
      "codeRemaining",
      "trialEnded",
      "callLimitReached",
      "unavailable",
    ].sort(),
  );
  for (const value of [
    hash,
    config.apiKey,
    config.redisToken,
    config.redisUrl,
    "costUsed",
    "maxCost",
  ])
    expect(JSON.stringify(state)).not.toContain(value);
  expect(
    await createTrialService(config, {
      store: createMemoryTrialStore({ cost: MAX }),
    }).status(code),
  ).toMatchObject({ available: false, trialEnded: true });
});
test.each([
  { host: "evil.test", origin: "https://evil.test" },
  { host: "trial.test", origin: null },
  { host: "trial.test", origin: "https://evil.test" },
  { host: "trial.test", origin: "http://trial.test" },
  {
    host: "trial.test",
    origin: "https://trial.test",
    contentType: "text/plain",
  },
  {
    host: "trial.test",
    origin: "https://trial.test",
    contentType: "application/jsonx",
  },
])("公网访问限制在调用和预留前拒绝：%j", async (v) => {
  const run = vi.fn(),
    send = vi.fn();
  const handlers = createHandlers(undefined, {
    env,
    store: { run },
    fetch: send,
  });
  const headers: Record<string, string> = {
    Host: v.host,
    "Content-Type": v.contentType ?? "application/json",
    "X-JDelight-Invite": code,
  };
  if (v.origin) headers.Origin = v.origin;
  const response = await handlers.POST(
    new Request("https://trial.test/api/analysis", {
      method: "POST",
      headers,
      body: JSON.stringify(input()),
    }),
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(run).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
test("有效公网请求使用试用服务；本机模式仍只接受 localhost", async () => {
  const local = createAnalysisService({ config: async () => null });
  const handlers = createHandlers(local, {
    env,
    store: createMemoryTrialStore(),
    fetch: async () => reply(),
  });
  const request = new Request("https://trial.test/api/analysis", {
    method: "POST",
    headers: {
      Host: "trial.test",
      Origin: "https://trial.test",
      "Content-Type": "application/json",
      "X-JDelight-Invite": "abcde-fghjk",
    },
    body: JSON.stringify(input()),
  });
  expect((await (await handlers.POST(request)).json()).ok).toBe(true);
  const absent = new Request("https://trial.test/api/analysis", {
    method: "POST",
    headers: {
      Host: "trial.test",
      Origin: "https://trial.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input()),
  });
  expect((await handlers.POST(absent)).status).toBe(403);
  const bad = createHandlers(local, {
    env: { ...env, UPSTASH_REDIS_REST_TOKEN: undefined },
  });
  expect(
    (
      await bad.GET(
        new Request("https://trial.test/api/analysis/status", {
          headers: { Host: "trial.test" },
        }),
      )
    ).status,
  ).toBe(403);
  const original = createHandlers(local, { env: {} });
  expect(
    (
      await original.GET(
        new Request("https://trial.test/api/analysis/status", {
          headers: { Host: "trial.test" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await original.GET(
        new Request("http://localhost/api/analysis/status", {
          headers: { Host: "localhost" },
        }),
      )
    ).status,
  ).toBe(200);
});

test("Redis 构造层也拒绝非 HTTPS、带凭据或不完整配置", () => {
  for (const bad of [
    { ...config, redisUrl: "http://redis.test.invalid" },
    { ...config, redisUrl: "https://user:pass@redis.test.invalid" },
    { ...config, redisToken: "" },
  ])
    expect(() => createRedisTrialStore(bad)).toThrow("试用记账服务暂不可用");
});
test("试用配置缺项的状态响应明确 available=false，不能回退本机", async () => {
  const response = await createHandlers(undefined, {
    env: { ...env, UPSTASH_REDIS_REST_TOKEN: undefined },
  }).GET(
    new Request("https://trial.test/api/analysis/status", {
      headers: { Host: "trial.test" },
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    mode: "trial",
    available: false,
    unavailable: true,
  });
});
test("结算失败保留最高预留，退份且停止自动重试", async () => {
  const memory = createMemoryTrialStore(),
    send = vi.fn<typeof fetch>(async () => reply("bad json"));
  const store: TrialStore = {
    run: async (cmd) => {
      if (cmd.op === "settle") throw new Error("fake outage");
      return memory.run(cmd);
    },
  };
  const result = await createTrialService(config, {
    store,
    fetch: send,
  }).analyze(input(), code);
  expect(result.response).toMatchObject({ ok: false, kind: "config" });
  expect(send).toHaveBeenCalledTimes(1);
  expect((await memory.run(trialCommand("status", hash))).slice(1, 4)).toEqual([
    R,
    0,
    1,
  ]);
});
test("最终占份状态不能确认时拒绝返回报告，过期恢复占份而不退已确认费用", async () => {
  const memory = createMemoryTrialStore();
  const store: TrialStore = {
    run: async (cmd) => {
      if (cmd.op === "finish") throw new Error("fake outage");
      return memory.run(cmd);
    },
  };
  const result = await createTrialService(config, {
    store,
    fetch: async () => reply(),
  }).analyze(input(), code);
  expect(result.response).toMatchObject({ ok: false, kind: "config" });
  expect((await memory.run(trialCommand("status", hash)))[2]).toBe(1);
  const restored = await memory.run(
    trialCommand("status", hash, crypto.randomUUID(), crypto.randomUUID(), {
      now: Date.now() + ANALYSIS_LEASE_MS + 1,
    }),
  );
  expect(restored[2]).toBe(0);
  expect(restored[1]).toBe(Math.round(estimateCost(1000, 500) * 1e6));
  expect(restored[3]).toBe(1);
});
test("不同服务实例按同码哈希共用额度", async () => {
  const store = createMemoryTrialStore();
  for (let i = 0; i < 2; i++)
    expect(
      (
        await createTrialService(config, {
          store,
          fetch: async () => reply(),
        }).analyze(input(), i ? "abcde-fghjk" : code)
      ).response.ok,
    ).toBe(true);
  expect(
    await createTrialService(config, { store }).status(code),
  ).toMatchObject({ codeRemaining: 13 });
});
