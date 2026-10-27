import type { TrialStore } from "../src/server/trial-store.ts";
export function runTrialSelfcheck(
  makeStore: (prefix: string) => TrialStore,
  cleanup: (prefix: string) => Promise<void>,
): Promise<{
  passed: boolean;
  reservations: number;
  questionReservations: number;
}>;
export function deleteSelfcheckKeys(
  config: { redisUrl: string; redisToken: string },
  prefix: string,
  send?: typeof fetch,
): Promise<void>;
