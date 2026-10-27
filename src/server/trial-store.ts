import "server-only";
import { z } from "zod";
import { LedgerError } from "./ledger.ts";
import {
  MAX_CALL_COST_CNY,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  estimateCost,
} from "./pricing.ts";
export const TRIAL_MAX_COST_MICRO_CNY = 30_000_000;
export const PER_CODE_ANALYSES = 15;
export const PER_CODE_MAX_CALLS = 40;
export const TRIAL_CALL_RESERVE = Math.round(MAX_CALL_COST_CNY * 1_000_000);
export const PER_CODE_QUESTIONS = 20;
export const PER_CODE_QUESTION_CALLS = 30;
export const QUESTION_MAX_INPUT_TOKENS = 16384;
export const QUESTION_MAX_OUTPUT_TOKENS = 1500;
export const QUESTION_CALL_RESERVE = Math.round(
  estimateCost(QUESTION_MAX_INPUT_TOKENS, QUESTION_MAX_OUTPUT_TOKENS) *
    1_000_000,
);
// 仅恢复被终止进程占用的份数；金额、调用数和成功份数永不按时间重置。
export const ANALYSIS_LEASE_MS = 600_000;
export const trialReceiptSchema = z.strictObject({
  result: z.enum(["ok", "check_failed", "format_failed", "network", "timeout"]),
  inputTokens: z.number().int().min(0).max(MAX_INPUT_TOKENS).nullable(),
  outputTokens: z.number().int().min(0).max(MAX_OUTPUT_TOKENS).nullable(),
  estimatedCostMicro: z.number().int().min(0).max(TRIAL_CALL_RESERVE),
  elapsedMs: z.number().int().min(0).max(3_600_000),
});
export const trialCommandSchema = z
  .strictObject({
    op: z.enum([
      "status",
      "claim",
      "reserve",
      "finish",
      "settle",
      "question-reserve",
      "question-settle",
      "question-finish",
    ]),
    code: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.uuid(),
    analysisId: z.uuid(),
    now: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - ANALYSIS_LEASE_MS),
    time: z.iso.datetime(),
    success: z.boolean(),
    receipt: trialReceiptSchema.optional(),
  })
  .refine((cmd) => !cmd.op.endsWith("settle") || !!cmd.receipt);
export type TrialCommand = z.infer<typeof trialCommandSchema>;
export type TrialReceipt = z.infer<typeof trialReceiptSchema>;
export const trialReplySchema = z.tuple([
  z.enum([
    "ok",
    "total",
    "shares",
    "calls",
    "questions",
    "question-calls",
    "state",
  ]),
  z.number().int().min(0).max(TRIAL_MAX_COST_MICRO_CNY),
  z.number().int().min(0).max(PER_CODE_ANALYSES),
  z.number().int().min(0).max(PER_CODE_MAX_CALLS),
  z.string().max(36),
  z.number().int().min(0).max(PER_CODE_QUESTIONS),
  z.number().int().min(0).max(PER_CODE_QUESTION_CALLS),
]);
export type TrialReply = z.infer<typeof trialReplySchema>;
export interface TrialStore {
  run(command: TrialCommand): Promise<TrialReply>;
}
export function trialStorageError() {
  return new LedgerError(
    "config",
    "试用记账服务暂不可用，未发起后续调用；已预留金额仍保留，请稍后再试",
  );
}
export function requireTrialOk(reply: TrialReply) {
  if (reply[0] === "ok") return reply;
  if (reply[0] === "state") throw trialStorageError();
  throw new LedgerError(
    "quota",
    reply[0] === "total"
      ? "试用额度已用完，感谢参与！现在仍可使用模拟分析。"
      : reply[0] === "calls"
        ? "这个邀请码的可用调用次数已用完，请联系发码人。"
        : reply[0] === "questions"
          ? "这个码的 20 次提问已用完，仍可查看已有解答。"
          : reply[0] === "question-calls"
            ? "这个码的可用提问调用次数已用完，仍可查看已有解答。"
            : "这个邀请码的 15 份已用完，请联系发码人。",
  );
}

// 四个 KEYS 必须共享同一 Redis hash tag。所有预留检查与写入在一次 EVAL 内。
export const TRIAL_LUA = `local p = cjson.decode(ARGV[1])
local MAX, SHARES, CALLS, RESERVE, LEASE = ${TRIAL_MAX_COST_MICRO_CNY}, ${PER_CODE_ANALYSES}, ${PER_CODE_MAX_CALLS}, ${TRIAL_CALL_RESERVE}, ${ANALYSIS_LEASE_MS}
local QUESTIONS, QCALLS, QRESERVE = ${PER_CODE_QUESTIONS}, ${PER_CODE_QUESTION_CALLS}, ${QUESTION_CALL_RESERVE}
local question = string.sub(p.op,1,9) == 'question-'
local op = question and string.sub(p.op,10) or p.op
local kind = question and 'question' or 'analysis'
local s, jobs, calls, log = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
for i,k in ipairs(KEYS) do
  local t = redis.call('TYPE', k).ok
  if t ~= 'none' and t ~= (i == 4 and 'list' or 'hash') then return redis.error_reply('invalid state') end
end
if redis.call('EXISTS', s) == 0 then
  if redis.call('EXISTS', jobs, calls, log) > 0 then return redis.error_reply('missing state') end
  redis.call('HSET', s, 'schema', 1, 'cost', 0)
end
if redis.call('HGET', s, 'schema') ~= '1' then return redis.error_reply('invalid schema') end
local cost = tonumber(redis.call('HGET', s, 'cost'))
local akey, ckey = 'a:' .. p.code, 'c:' .. p.code
local a = tonumber(redis.call('HGET', s, akey) or '0')
local c = tonumber(redis.call('HGET', s, ckey) or '0')
local qkey, qckey = 'q:' .. p.code, 'qc:' .. p.code
local q = tonumber(redis.call('HGET', s, qkey) or '0')
local qc = tonumber(redis.call('HGET', s, qckey) or '0')
local function integer(n, max) return n and n >= 0 and n <= max and n == math.floor(n) end
if not integer(cost, MAX) or not integer(a, SHARES) or not integer(c, CALLS) or not integer(q, QUESTIONS) or not integer(qc, QCALLS) then return redis.error_reply('invalid counters') end
local function reply(result, id) return {result, cost, a, c, id or '', q, qc} end
local function putjob(id,j) redis.call('HSET', jobs, id, cjson.encode(j)) end
-- 清理当前码过期的未完成占份，不退金额或调用数。最长运行 300 秒，租约 600 秒。
local all = redis.call('HGETALL', jobs)
for i=1,#all,2 do
  local j = cjson.decode(all[i+1])
  if j.code == p.code and j.status == 'pending' and j.expires <= p.now then
    if j.type == 'question' then
      if q <= 0 then return redis.error_reply('invalid questions') end
      q = q - 1; redis.call('HSET', s, qkey, q)
    else
      if a <= 0 then return redis.error_reply('invalid shares') end
      a = a - 1; redis.call('HSET', s, akey, a)
    end
    redis.call('HDEL',jobs,all[i])
  end
end
if p.op == 'status' then return reply('ok') end
local jraw = redis.call('HGET', jobs, p.analysisId)
local j = jraw and cjson.decode(jraw) or nil
local rraw = redis.call('HGET', calls, p.id)
local r = rraw and cjson.decode(rraw) or nil
if question and op == 'reserve' then
  if j or r then
    if j and r and j.code == p.code and j.status == 'pending' and j.type == kind and r.code == p.code and r.analysisId == p.analysisId and r.type == kind then return reply('ok',p.id) end
    return reply('state')
  end
  if q >= QUESTIONS then return reply('questions') end
  if qc >= QCALLS then return reply('question-calls') end
  if cost + QRESERVE > MAX then return reply('total') end
  cost = cost + QRESERVE; q = q + 1; qc = qc + 1
  redis.call('HSET', s, 'cost', cost, qkey, q, qckey, qc)
  putjob(p.analysisId,{code=p.code,type=kind,status='pending',expires=p.now+LEASE})
  redis.call('HSET', calls, p.id, cjson.encode({code=p.code,type=kind,analysisId=p.analysisId,cost=QRESERVE,status='pending'}))
  redis.call('LPUSH',log,cjson.encode({id=p.id,type=kind,time=p.time,codePrefix=string.sub(p.code,1,8),result='pending',inputTokens=cjson.null,outputTokens=cjson.null,estimatedCostMicro=QRESERVE,elapsedMs=cjson.null}))
  redis.call('LTRIM',log,0,999); return reply('ok',p.id)
end
if p.op == 'claim' then
  if j then return reply(j.code == p.code and j.type ~= 'question' and j.status == 'pending' and 'ok' or 'state',p.analysisId) end
  if a >= SHARES then return reply('shares') end
  if c >= CALLS then return reply('calls') end
  if cost + RESERVE > MAX then return reply('total') end
  a = a + 1; redis.call('HSET', s, akey, a)
  putjob(p.analysisId,{code=p.code,type='analysis',status='pending',expires=p.now+LEASE})
  return reply('ok',p.analysisId)
end
if not j or j.code ~= p.code or (j.type or 'analysis') ~= kind then return reply('state') end
if op == 'finish' then
  if j.status ~= 'pending' then return reply('state') end
  if not p.success then
    if question then
      if q <= 0 then return reply('state') end
      q = q - 1; redis.call('HSET', s, qkey, q)
    else
      if a <= 0 then return reply('state') end
      a = a - 1; redis.call('HSET', s, akey, a)
    end
  end
  redis.call('HDEL',jobs,p.analysisId); return reply('ok',p.analysisId)
end
if p.op == 'reserve' then
  if j.status ~= 'pending' then return reply('state') end
  if r then return reply(r.code == p.code and r.analysisId == p.analysisId and r.type ~= 'question' and 'ok' or 'state',p.id) end
  if c >= CALLS then return reply('calls') end
  if cost + RESERVE > MAX then return reply('total') end
  cost = cost + RESERVE; c = c + 1
  redis.call('HSET', s, 'cost', cost, ckey, c)
  redis.call('HSET', calls, p.id, cjson.encode({code=p.code,type=kind,analysisId=p.analysisId,cost=RESERVE,status='pending'}))
  redis.call('LPUSH',log,cjson.encode({id=p.id,type=kind,time=p.time,codePrefix=string.sub(p.code,1,8),result='pending',inputTokens=cjson.null,outputTokens=cjson.null,estimatedCostMicro=RESERVE,elapsedMs=cjson.null}))
  redis.call('LTRIM',log,0,999); return reply('ok',p.id)
end
if op ~= 'settle' or not r or r.code ~= p.code or r.analysisId ~= p.analysisId or (r.type or 'analysis') ~= kind then return reply('state') end
if r.status == 'settled' then return reply('ok',p.id) end
if not integer(r.cost,question and QRESERVE or RESERVE) or not integer(p.receipt.estimatedCostMicro,r.cost) or cost < r.cost - p.receipt.estimatedCostMicro then return reply('state') end
cost = cost - r.cost + p.receipt.estimatedCostMicro
r.cost = p.receipt.estimatedCostMicro; r.status = 'settled'
redis.call('HSET',s,'cost',cost); redis.call('HSET',calls,p.id,cjson.encode(r))
local receipt = p.receipt
receipt.id = p.id; receipt.time = p.time; receipt.codePrefix = string.sub(p.code,1,8)
receipt.type = kind
local rows = redis.call('LRANGE',log,0,999)
for i,v in ipairs(rows) do
  if cjson.decode(v).id == p.id then redis.call('LSET',log,i-1,cjson.encode(receipt)); return reply('ok',p.id) end
end
redis.call('LPUSH',log,cjson.encode(receipt)); redis.call('LTRIM',log,0,999)
return reply('ok',p.id)`;
