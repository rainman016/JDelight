import "server-only";
import { BASE_URL, MODEL_ID } from "./pricing.ts";
export interface TrialConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  redisUrl: string;
  redisToken: string;
  hashes: string[];
  allowedHosts: string[];
}
const trialKeys = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "JDELIGHT_INVITE_HASHES",
  "JDELIGHT_ALLOWED_HOSTS",
] as const;
export function readRedisConfig(env: Record<string, string | undefined>) {
  const primary = !!(
    env.UPSTASH_REDIS_REST_URL?.trim() || env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
  const redisUrl = (
    primary ? env.UPSTASH_REDIS_REST_URL : env.KV_REST_API_URL
  )?.trim();
  const redisToken = (
    primary ? env.UPSTASH_REDIS_REST_TOKEN : env.KV_REST_API_TOKEN
  )?.trim();
  if (!redisUrl || !redisToken || /[\r\n]/.test(redisToken)) return null;
  try {
    const url = new URL(redisUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return { redisUrl: url.origin, redisToken };
  } catch {
    return null;
  }
}
export function readTrialMode(
  env: Record<string, string | undefined> = process.env,
):
  | { enabled: false; config: null }
  | { enabled: true; config: TrialConfig | null } {
  if (env.VERCEL !== "1" && !trialKeys.some((key) => env[key]?.trim()))
    return { enabled: false, config: null };
  const unavailable = { enabled: true, config: null } as const;
  const redis = readRedisConfig(env);
  const apiKey = env.EASYROUTER_API_KEY?.trim();
  const baseUrl = env.EASYROUTER_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.EASYROUTER_MODEL?.trim();
  const hashes = env.JDELIGHT_INVITE_HASHES?.split(",").map((v) =>
    v.trim().toLowerCase(),
  );
  const allowedHosts = env.JDELIGHT_ALLOWED_HOSTS?.split(",").map((v) =>
    v.trim().toLowerCase(),
  );
  if (
    !redis ||
    !apiKey ||
    /[\r\n]/.test(apiKey) ||
    baseUrl !== BASE_URL ||
    model !== MODEL_ID ||
    !hashes?.length ||
    hashes.length > 1000 ||
    hashes.some((h) => !/^[a-f0-9]{64}$/.test(h)) ||
    !allowedHosts?.length ||
    allowedHosts.length > 32 ||
    allowedHosts.some((host) => {
      if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9]\d{0,4})?$/.test(host))
        return true;
      try {
        return new URL(`https://${host}`).host !== host;
      } catch {
        return true;
      }
    })
  )
    return unavailable;
  return {
    enabled: true,
    config: {
      ...redis,
      apiKey,
      baseUrl,
      model,
      hashes: [...new Set(hashes)],
      allowedHosts: [...new Set(allowedHosts)],
    },
  };
}
