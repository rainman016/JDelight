import "server-only";
export async function readJsonStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<unknown> {
  if (!body) throw new Error("missing body");
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("body limit");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
