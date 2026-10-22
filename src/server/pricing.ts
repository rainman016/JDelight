import "server-only";
// EasyRouter 官方模型广场 https://easyrouter.io/pricing 与公开数据 https://easyrouter.io/api/pricing
// 查阅 2026-10-22：deepseek-flash model_ratio=0.15，completion_ratio=4，default 分组倍率=1。
// 页面公开脚本换算 inputUSD/1M = model_ratio * 2 * groupRatio，output = input * completion_ratio。
// https://easyrouter.io/assets/index-CXf8JJfS.js；本工单按 1 USD = 7.3 CNY，忽略缓存折扣作保守估算。
export const MODEL_ID = "deepseek-flash";
export const BASE_URL = "https://easyrouter.io/v1";
export const INPUT_USD_PER_MILLION = 0.3;
export const OUTPUT_USD_PER_MILLION = 1.2;
export const USD_TO_CNY = 7.3;
export const MAX_CALLS = 10;
export const MAX_COST_CNY = 5;
export const MAX_SMOKE_CALLS = 2;
export const MAX_QUALITY_CALLS = 8;
export const MAX_INPUT_TOKENS = 65536;
export const MAX_OUTPUT_TOKENS = 12000;
export const TIMEOUT_MS = 90000;
export function estimateCost(input: number, output: number) {
  return (
    Math.ceil(
      (input * INPUT_USD_PER_MILLION + output * OUTPUT_USD_PER_MILLION) *
        USD_TO_CNY,
    ) / 1_000_000
  );
}
export const MAX_CALL_COST_CNY = estimateCost(
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
);
