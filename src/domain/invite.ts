export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function normalizeInvite(value: string): string | null {
  const normalized = value.trim().replaceAll("-", "").toUpperCase();
  return normalized.length === 10 &&
    [...normalized].every((char) => INVITE_ALPHABET.includes(char))
    ? normalized
    : null;
}
