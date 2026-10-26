import "server-only";
import {
  TRIAL_LUA,
  trialCommandSchema,
  trialReplySchema,
  trialStorageError,
  type TrialStore,
} from "./trial-store.ts";
import { readRedisConfig } from "./trial-config.ts";
export const TRIAL_PREFIX = "{jdelight-trial-v1}";
export function trialKeys(prefix: string) {
  return ["state", "analyses", "calls", "receipts"].map(
    (key) => `${prefix}:${key}`,
  );
}
export function createRedisTrialStore(
  config: { redisUrl: string; redisToken: string },
  options: { fetch?: typeof fetch; prefix?: string; timeoutMs?: number } = {},
): TrialStore {
  if (
    !readRedisConfig({
      UPSTASH_REDIS_REST_URL: config.redisUrl,
      UPSTASH_REDIS_REST_TOKEN: config.redisToken,
    })
  )
    throw trialStorageError();
  const send = options.fetch ?? globalThis.fetch;
  const keys = trialKeys(options.prefix ?? TRIAL_PREFIX);
  return {
    async run(input) {
      try {
        const command = trialCommandSchema.parse(input);
        const response = await send(config.redisUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.redisToken}`,
          },
          body: JSON.stringify([
            "EVAL",
            TRIAL_LUA,
            keys.length,
            ...keys,
            JSON.stringify(command),
          ]),
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
        });
        if (!response.ok || response.redirected || !response.body) {
          await response.body?.cancel();
          throw trialStorageError();
        }
        const reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 65536) {
              await reader.cancel();
              throw trialStorageError();
            }
            parts.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const data: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (
          !data ||
          typeof data !== "object" ||
          Object.keys(data).length !== 1 ||
          !("result" in data)
        )
          throw trialStorageError();
        const reply = trialReplySchema.parse(data.result);
        if (
          reply[0] === "ok" &&
          command.op !== "status" &&
          reply[4] !==
            (command.op === "claim" || command.op === "finish"
              ? command.analysisId
              : command.id)
        )
          throw trialStorageError();
        return reply;
      } catch {
        throw trialStorageError();
      }
    },
  };
}
