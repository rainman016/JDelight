import "server-only";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { BASE_URL, MODEL_ID } from "./pricing.ts";
import { outsideRepository } from "./paths.ts";
export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  ledgerPath: string;
}
export async function readConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<ServerConfig | null> {
  const apiKey = env.EASYROUTER_API_KEY?.trim();
  const baseUrl = env.EASYROUTER_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.EASYROUTER_MODEL?.trim();
  const ledgerPath = env.JDELIGHT_LEDGER_PATH?.trim();
  if (!apiKey || !baseUrl || !model || !ledgerPath) return null;
  if (baseUrl !== BASE_URL || model !== MODEL_ID || /[\r\n]/.test(apiKey))
    return null;
  // 只能作为账本读普通 JSON；拒绝已知凭据文件名，且不跟随账本本身的符号链接。
  const name = path.basename(ledgerPath);
  if (
    !/\.json$/i.test(name) ||
    /auth|secret|credential|password|token|\.env/i.test(name)
  )
    return null;
  try {
    if (
      !(await lstat(ledgerPath)).isFile() ||
      (await lstat(ledgerPath)).isSymbolicLink()
    )
      return null;
    return {
      apiKey,
      baseUrl,
      model,
      ledgerPath: await outsideRepository(ledgerPath, "file"),
    };
  } catch {
    return null;
  }
}
