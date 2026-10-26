import { normalizeInvite } from "@/domain/invite";
const key = "jdelight:invite";
let memory: string | null = null;
export function readInvite() {
  if (memory) return memory;
  try {
    return normalizeInvite(localStorage.getItem(key) ?? "");
  } catch {
    return null;
  }
}
export function saveInvite(value: string) {
  const normalized = normalizeInvite(value);
  if (!normalized) return false;
  memory = normalized;
  try {
    localStorage.setItem(key, normalized);
  } catch {
    /* 本页仍可使用，刷新后可能需要重新输入。 */
  }
  return true;
}
export function inviteHeaders(
  code: string | null = readInvite(),
): Record<string, string> {
  return code ? { "X-JDelight-Invite": code } : {};
}
