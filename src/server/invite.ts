import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeInvite } from "../domain/invite.ts";
export function inviteHash(code: string) {
  const normalized = normalizeInvite(code);
  return normalized
    ? createHash("sha256").update(normalized).digest("hex")
    : null;
}
export function checkInvite(
  code: string | null,
  hashes: string[],
): string | null {
  const hashed = code && code.length <= 64 ? inviteHash(code) : null;
  const candidate = Buffer.from(hashed ?? "0".repeat(64), "hex");
  let matched = 0;
  for (const hash of hashes)
    matched |= Number(timingSafeEqual(candidate, Buffer.from(hash, "hex")));
  return hashed && matched ? hashed : null;
}
