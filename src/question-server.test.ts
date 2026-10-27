// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createAnswerService } from "./server/answer";
import { createAnswerHandlers } from "./server/answer-api";
import { createMemoryTrialStore } from "./server/trial-memory";
import { createTrialService, trialCommand } from "./server/trial-analysis";
import { createRedisTrialStore } from "./server/trial-redis";
import {
  buildQuestionMessages,
  QUESTION_SYSTEM_PROMPT,
} from "./server/question-prompt";
import { inviteHash } from "./server/invite";
import { BASE_URL, MODEL_ID, estimateCost } from "./server/pricing";
import {
  ANALYSIS_LEASE_MS,
  QUESTION_CALL_RESERVE as Q,
  TRIAL_CALL_RESERVE as A,
  TRIAL_MAX_COST_MICRO_CNY as MAX,
  requireTrialOk,
  type TrialStore,
} from "./server/trial-store";
import type { TrialConfig } from "./server/trial-config";
const code = "ABCDE-FGHJK",
  hash = inviteHash(code)!;
const config: TrialConfig = {
  apiKey: "wo005-model-fixture-never-export",
  baseUrl: BASE_URL,
  model: MODEL_ID,
  redisUrl: "https://redis.test.invalid",
  redisToken: "wo005-redis-fixture-never-export",
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
const source = {
  jobId: "fictional-job",
  question: "怎么理解这句话？",
  selected: "与团队一起梳理用户需求",
  source:
    "岗位职责：与团队一起梳理用户需求，形成产品方案并跟进交付。任职要求：具备沟通与分析能力。",
};
const model = (
  content: unknown = {
    answer: "可以从原文推断，这项工作需要与其他角色共同澄清需求。",
    kind: "inference",
  },
  usage: unknown = { prompt_tokens: 1000, completion_tokens: 100 },
) =>
  Response.json({
    choices: [
      {
        message: {
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        },
      },
    ],
    usage,
  });
afterEach(() => vi.restoreAllMocks());

test("提问最高预留为 49021 微元，提示词随机隔离原文并限制输入字节", () => {
  expect(Q).toBe(49021);
  const first = buildQuestionMessages(source),
    second = buildQuestionMessages(source);
  expect(first[0].content).toBe(QUESTION_SYSTEM_PROMPT);
  expect(first[1].content).not.toBe(second[1].content);
  expect(first[1].content).toContain(source.source);
  expect(QUESTION_SYSTEM_PROMPT).toContain("禁止使用 source");
  expect(() =>
    buildQuestionMessages({ ...source, source: "长".repeat(12000) }),
  ).toThrow("原文太长，暂时无法提问");
});

test.each(["common", "inference", "speculation"])(
  "有效解答 %s：只调用一次，计次及实际费用正确，不返回内部信息",
  async (kind) => {
    const store = createMemoryTrialStore();
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${config.apiKey}`,
      });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        max_tokens: 1500,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        stream: false,
      });
      return model({ answer: "行业里通常会先梳理需求，再协作交付。", kind });
    });
    const result = await createAnswerService(config, {
      store,
      fetch: send,
    }).answer(source, code);
    expect(result).toEqual({
      ok: true,
      answer: "行业里通常会先梳理需求，再协作交付。",
      kind,
      questionsRemaining: 19,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.inspect().cost).toBe(
      Math.round(estimateCost(1000, 100) * 1e6),
    );
    expect(store.inspect().jobs).toEqual([]);
    expect(store.inspect().receipts[0]).toMatchObject({
      type: "question",
      result: "ok",
    });
    for (const value of [
      source.source,
      source.question,
      source.selected,
      "行业里通常",
      config.apiKey,
      config.redisToken,
      hash,
    ])
      expect(JSON.stringify(store.inspect().receipts)).not.toContain(value);
  },
);

test("第 20 次解答成功后第 21 次拒绝，不能继续调用模型", async () => {
  const store = createMemoryTrialStore(),
    send = vi.fn<typeof fetch>(async () => model());
  const service = createAnswerService(config, { store, fetch: send });
  for (let i = 0; i < 20; i++)
    expect(await service.answer(source, code)).toMatchObject({
      ok: true,
      questionsRemaining: 19 - i,
    });
  expect(await service.answer(source, code)).toMatchObject({
    ok: false,
    kind: "quota",
  });
  expect(send).toHaveBeenCalledTimes(20);
  expect(store.inspect().jobs).toEqual([]);
});

test("连续 30 次调用失败均退次不退钱，第 31 次由调用硬上限拒绝", async () => {
  const store = createMemoryTrialStore(),
    send = vi.fn<typeof fetch>(async () => {
      throw new Error("fake network");
    });
  const service = createAnswerService(config, { store, fetch: send });
  for (let i = 0; i < 30; i++)
    expect(await service.answer(source, code)).toMatchObject({
      ok: false,
      kind: "network",
    });
  expect(await service.answer(source, code)).toMatchObject({
    ok: false,
    kind: "quota",
  });
  expect(send).toHaveBeenCalledTimes(30);
  const state = await store.run(trialCommand("status", hash));
  expect([state[1], state[5], state[6]]).toEqual([30 * Q, 0, 30]);
  expect(store.inspect().jobs).toEqual([]);
});

test.each([
  null,
  { prompt_tokens: -1, completion_tokens: 0 },
  { prompt_tokens: 16385, completion_tokens: 1 },
  { prompt_tokens: 1, completion_tokens: 1501 },
])("未知或越界 usage 保留最高预留：%j", async (usage) => {
  const store = createMemoryTrialStore();
  expect(
    await createAnswerService(config, {
      store,
      fetch: async () => model(undefined, usage),
    }).answer(source, code),
  ).toMatchObject({ ok: true });
  expect(store.inspect().cost).toBe(Q);
});

test.each([
  { answer: "原文", kind: "source" },
  { answer: "内容", kind: "other" },
  { answer: "  ", kind: "common" },
  { answer: "长".repeat(1201), kind: "common" },
  "not json",
  { answer: config.apiKey, kind: "inference" },
  { answer: config.redisToken, kind: "inference" },
  { answer: "合格答案", kind: "common", extra: true },
])("非法输出拒绝且无自动重试：%j", async (content) => {
  const store = createMemoryTrialStore(),
    send = vi.fn<typeof fetch>(async () => model(content));
  const result = await createAnswerService(config, {
    store,
    fetch: send,
  }).answer(source, code);
  expect(result).toMatchObject({ ok: false, kind: "check" });
  expect(result).not.toHaveProperty("answer");
  expect(JSON.stringify(result)).not.toContain(config.apiKey);
  expect(JSON.stringify(result)).not.toContain(config.redisToken);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await store.run(trialCommand("status", hash))).slice(5)).toEqual([
    0, 1,
  ]);
  expect(store.inspect().cost).toBeGreaterThan(0);
  expect(store.inspect().jobs).toEqual([]);
});

test("连续 200 次超长原文预留前被拒绝，不调用存储或模型，不留记录", async () => {
  const memory = createMemoryTrialStore(),
    run = vi.fn(memory.run),
    send = vi.fn<typeof fetch>();
  const service = createAnswerService(config, { store: { run }, fetch: send });
  for (let i = 0; i < 200; i++)
    expect(
      await service.answer({ ...source, source: "长".repeat(12000) }, code),
    ).toEqual({
      ok: false,
      kind: "check",
      reasons: ["原文太长，暂时无法提问"],
    });
  expect(run).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(memory.inspect()).toMatchObject({
    cost: 0,
    jobs: [],
    reservations: [],
  });
});

test.each([false, true])(
  "超时／取消均退次、删除记录，保留预留与调用数：取消=%s",
  async (cancel) => {
    const store = createMemoryTrialStore(),
      ctrl = new AbortController();
    const send: typeof fetch = async (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("fake abort")),
          { once: true },
        );
        if (cancel) ctrl.abort();
      });
    expect(
      await createAnswerService(config, {
        store,
        fetch: send,
        timeoutMs: 5,
      }).answer(source, code, ctrl.signal),
    ).toMatchObject({ ok: false, kind: "network" });
    const state = await store.run(trialCommand("status", hash));
    expect([state[1], state[5], state[6]]).toEqual([Q, 0, 1]);
    expect(store.inspect().jobs).toEqual([]);
  },
);

test("进程终止的提问租约过期后退次并删除，重复结束不重复退次", async () => {
  const store = createMemoryTrialStore(),
    id = crypto.randomUUID();
  requireTrialOk(
    await store.run(trialCommand("question-reserve", hash, id, id)),
  );
  expect((await store.run(trialCommand("reserve", hash, id, id)))[0]).toBe(
    "state",
  );
  const status = await store.run(
    trialCommand("status", hash, id, id, {
      now: Date.now() + ANALYSIS_LEASE_MS + 1,
    }),
  );
  expect([status[1], status[5], status[6]]).toEqual([Q, 0, 1]);
  expect(store.inspect().jobs).toEqual([]);
  expect(
    (await store.run(trialCommand("question-finish", hash, id, id)))[0],
  ).toBe("state");
  expect((await store.run(trialCommand("status", hash)))[5]).toBe(0);
});

test.each(["question-settle", "question-finish"])(
  "%s 存储故障拒绝交付解答，费用保守保留且最终退次",
  async (op) => {
    const memory = createMemoryTrialStore();
    const store: TrialStore = {
      run: async (cmd) => {
        if (cmd.op === op) throw new Error("fake outage");
        return memory.run(cmd);
      },
    };
    expect(
      await createAnswerService(config, {
        store,
        fetch: async () => model(),
      }).answer(source, code),
    ).toMatchObject({ ok: false, kind: "config" });
    const status = await memory.run(
      trialCommand("status", hash, crypto.randomUUID(), crypto.randomUUID(), {
        now: Date.now() + ANALYSIS_LEASE_MS + 1,
      }),
    );
    expect(status[5]).toBe(0);
    expect(status[6]).toBe(1);
    expect(status[1]).toBeGreaterThan(0);
    expect(memory.inspect().jobs).toEqual([]);
  },
);

test("分析与提问各 25 个混合预留共用总额，最后 3 次分析与 7 次提问恰好用尽", async () => {
  const store = createMemoryTrialStore({ cost: MAX - 3 * A - 7 * Q });
  const analysis = Array.from({ length: 25 }, (_, i) => ({
    id: crypto.randomUUID(),
    hash: createHash("sha256").update(`mixed-analysis-${i}`).digest("hex"),
  }));
  for (const item of analysis)
    requireTrialOk(
      await store.run(trialCommand("claim", item.hash, item.id, item.id)),
    );
  const replies = await Promise.all(
    analysis.flatMap((item, i) => {
      const id = crypto.randomUUID(),
        codeHash = createHash("sha256")
          .update(`mixed-question-${i}`)
          .digest("hex");
      return [
        store.run(trialCommand("reserve", item.hash, item.id, item.id)),
        store.run(trialCommand("question-reserve", codeHash, id, id)),
      ];
    }),
  );
  expect(replies.filter((r, i) => i % 2 === 0 && r[0] === "ok")).toHaveLength(
    3,
  );
  expect(replies.filter((r, i) => i % 2 === 1 && r[0] === "ok")).toHaveLength(
    7,
  );
  expect(
    replies.every(
      (r) =>
        r[1] <= MAX && r[2] <= 15 && r[3] <= 40 && r[5] <= 20 && r[6] <= 30,
    ),
  ).toBe(true);
  expect(store.inspect().cost).toBe(MAX);
});

test("分析已用尽仍可提问，状态只增加本码的提问字段", async () => {
  const store = createMemoryTrialStore({ code: hash, analyses: 15, calls: 40 });
  const state = await createTrialService(config, { store }).status(code);
  expect(state).toMatchObject({
    available: false,
    questionsRemaining: 20,
    questionCallLimitReached: false,
  });
  for (const value of ["cost", "maxCost", hash, config.apiKey])
    expect(JSON.stringify(state)).not.toContain(value);
  expect(
    await createAnswerService(config, {
      store,
      fetch: async () => model(),
    }).answer(source, code),
  ).toMatchObject({ ok: true });
});

test.each([
  { Host: "evil.test", Origin: "https://evil.test" },
  { Origin: undefined },
  { Origin: "https://evil.test" },
  { Origin: "http://trial.test" },
  { "Content-Type": "text/plain" },
  { "Content-Type": "application/jsonx" },
  { "X-JDelight-Invite": "ABCDE-FGHJM" },
  { "X-JDelight-Invite": undefined },
])("提问接口在存储与调用前拒绝不合格访问：%j", async (change) => {
  const run = vi.fn(),
    send = vi.fn<typeof fetch>();
  const headers = new Headers({
    Host: "trial.test",
    Origin: "https://trial.test",
    "Content-Type": "application/json",
    "X-JDelight-Invite": code,
  });
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) headers.delete(key);
    else headers.set(key, value);
  }
  const result = await createAnswerHandlers({
    env,
    store: { run },
    fetch: send,
  }).POST(
    new Request("https://trial.test/api/answer", {
      method: "POST",
      headers,
      body: JSON.stringify(source),
    }),
  );
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(run).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("本机模式提问接口不可用；合法试用请求返回干净 JSON，Redis 故障不能发模型调用", async () => {
  const request = () =>
    new Request("https://trial.test/api/answer", {
      method: "POST",
      headers: {
        Host: "trial.test",
        Origin: "https://trial.test",
        "Content-Type": "application/json; charset=utf-8",
        "X-JDelight-Invite": code,
      },
      body: JSON.stringify(source),
    });
  const send = vi.fn<typeof fetch>();
  expect(
    (await createAnswerHandlers({ env: {}, fetch: send }).POST(request()))
      .status,
  ).toBe(403);
  expect(send).not.toHaveBeenCalled();
  const response = await createAnswerHandlers({
    env,
    store: createMemoryTrialStore(),
    fetch: async () => model(),
  }).POST(request());
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(Object.keys(await response.json()).sort()).toEqual(
    ["answer", "kind", "ok", "questionsRemaining"].sort(),
  );
  const redis = createRedisTrialStore(config, {
    fetch: async () => Response.json({ error: "fake Redis error" }),
  });
  expect(
    await createAnswerService(config, { store: redis, fetch: send }).answer(
      source,
      code,
    ),
  ).toMatchObject({ ok: false, kind: "config" });
  expect(send).not.toHaveBeenCalled();
});
