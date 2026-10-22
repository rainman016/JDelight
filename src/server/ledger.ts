import "server-only";
import { z } from "zod";
import { lstat, readFile, open, rename, unlink } from "node:fs/promises";
import {
  MAX_CALLS,
  MAX_COST_CNY,
  MAX_CALL_COST_CNY,
  MAX_SMOKE_CALLS,
  MAX_QUALITY_CALLS,
  MODEL_ID,
} from "./pricing.ts";
export type Purpose = "smoke" | "quality";
export type Outcome =
  "pending" | "ok" | "check_failed" | "format_failed" | "network" | "timeout";
const amount = z.number().finite().nonnegative();
const entrySchema = z.strictObject({
  id: z.uuid(),
  time: z.iso.datetime(),
  purpose: z.enum(["smoke", "quality"]),
  model: z.literal(MODEL_ID),
  result: z.enum([
    "pending",
    "ok",
    "check_failed",
    "format_failed",
    "network",
    "timeout",
  ]),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reservedCostCny: amount,
  estimatedCostCny: amount,
  elapsedMs: z.number().int().nonnegative().nullable(),
});
export const ledgerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(entrySchema),
});
export type Ledger = z.infer<typeof ledgerSchema>;
export type LedgerEntry = z.infer<typeof entrySchema>;
export class LedgerError extends Error {
  constructor(
    public readonly kind: "config" | "quota",
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}
export function summarize(ledger: Ledger) {
  return {
    used: ledger.entries.length,
    costUsedCny:
      Math.ceil(
        ledger.entries.reduce(
          (sum, entry) =>
            sum +
            Math.round(
              (entry.result === "pending"
                ? entry.reservedCostCny
                : entry.estimatedCostCny) * 1_000_000,
            ),
          0,
        ),
      ) / 1_000_000,
  };
}
export function ensureBudget(ledger: Ledger, purpose: Purpose) {
  const { used, costUsedCny } = summarize(ledger);
  if (used >= MAX_CALLS)
    throw new LedgerError(
      "quota",
      `本机最多 ${MAX_CALLS} 次真实调用，已用 ${used} 次，不会自动恢复`,
    );
  if (
    Math.round(costUsedCny * 1_000_000) +
      Math.round(MAX_CALL_COST_CNY * 1_000_000) >
    MAX_COST_CNY * 1_000_000
  )
    throw new LedgerError(
      "quota",
      `本机估算费用上限 ¥${MAX_COST_CNY}，已用约 ¥${costUsedCny.toFixed(4)}；本次最高预留费用超出余额，未发起调用`,
    );
  const limit = purpose === "smoke" ? MAX_SMOKE_CALLS : MAX_QUALITY_CALLS;
  const purposeUsed = ledger.entries.filter(
    (entry) => entry.purpose === purpose,
  ).length;
  if (purposeUsed >= limit)
    throw new LedgerError(
      "quota",
      purpose === "smoke"
        ? `施工冒烟最多 ${limit} 次，已用 ${purposeUsed} 次；其余调用留给合并后的质量验证，不会自动恢复`
        : `合并后质量验证最多 ${limit} 次，已用 ${purposeUsed} 次，不会自动恢复`,
    );
}
export async function readLedger(file: string): Promise<Ledger> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new Error();
    const value = ledgerSchema.parse(JSON.parse(await readFile(file, "utf8")));
    if (new Set(value.entries.map((e) => e.id)).size !== value.entries.length)
      throw new Error();
    for (const entry of value.entries) {
      if (
        entry.reservedCostCny < MAX_CALL_COST_CNY ||
        (entry.result === "pending" &&
          entry.estimatedCostCny !== entry.reservedCostCny)
      )
        throw new Error();
    }
    return value;
  } catch {
    throw new LedgerError(
      "config",
      "账本不存在、损坏或不可读，未发起调用；已有账本不能当作零次或覆盖重建",
    );
  }
}
async function atomicWrite(file: string, ledger: Ledger) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(
        JSON.stringify(ledgerSchema.parse(ledger), null, 2) + "\n",
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch {
    throw new LedgerError(
      "config",
      "账本写入失败，已预留记录仍计次；未确认记账的后续请求不会发送",
    );
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
const shared = globalThis as typeof globalThis & {
  __jdelightLedgerQueues?: Map<string, Promise<void>>;
};
const queues = (shared.__jdelightLedgerQueues ??= new Map());
export async function withLedgerLock<T>(
  file: string,
  run: (ledger: Ledger) => Promise<T>,
): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  queues.set(file, tail);
  await previous;
  const lockPath = `${file}.lock`;
  let locked = false;
  try {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      locked = true;
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
    } catch {
      throw new LedgerError(
        "config",
        "账本正在被其他进程使用或无法锁定，未发起调用",
      );
    }
    return await run(await readLedger(file));
  } finally {
    if (locked) await unlink(lockPath).catch(() => {});
    release();
    if (queues.get(file) === tail) queues.delete(file);
  }
}
export async function reserve(file: string, ledger: Ledger, purpose: Purpose) {
  ensureBudget(ledger, purpose);
  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    purpose,
    model: MODEL_ID,
    result: "pending",
    inputTokens: null,
    outputTokens: null,
    reservedCostCny: MAX_CALL_COST_CNY,
    estimatedCostCny: MAX_CALL_COST_CNY,
    elapsedMs: null,
  };
  ledger.entries.push(entry);
  await atomicWrite(file, ledger);
  return entry;
}
export async function settle(
  file: string,
  ledger: Ledger,
  entry: LedgerEntry,
  update: Pick<
    LedgerEntry,
    "result" | "inputTokens" | "outputTokens" | "estimatedCostCny" | "elapsedMs"
  >,
) {
  const next = structuredClone(ledger);
  const stored = next.entries.find((e) => e.id === entry.id);
  if (!stored)
    throw new LedgerError("config", "未找到已预留的调用记录，未继续调用");
  Object.assign(stored, update);
  await atomicWrite(file, next);
  Object.assign(entry, update);
}
