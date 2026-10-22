import "server-only";
import { analysisService, type createAnalysisService } from "./analysis.ts";
type Service = ReturnType<typeof createAnalysisService>;
function localRequest(request: Request) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  if (!/^(localhost|127\.0\.0\.1)(?::[1-9]\d{0,4})?$/.test(host)) return false;
  const port = host.split(":")[1];
  if (port && Number(port) > 65535) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (
        parsed.host !== host ||
        parsed.protocol !== new URL(request.url).protocol
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
const failure = (kind: "config" | "network", reason: string, status = 400) =>
  Response.json(
    { ok: false, kind, reasons: [reason] },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export function createHandlers(service: Service = analysisService) {
  return {
    async GET(request: Request) {
      if (!localRequest(request))
        return failure("config", "仅允许本机同源请求", 403);
      return Response.json(await service.status(), {
        headers: { "Cache-Control": "no-store" },
      });
    },
    async POST(request: Request) {
      if (!localRequest(request))
        return failure("config", "仅允许本机同源请求", 403);
      if (
        !request.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        return failure("config", "请求需要 JSON 格式");
      let source: unknown;
      try {
        if (!request.body) return failure("config", "没有收到已确认原文");
        const reader = request.body.getReader();
        const parts: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > 2 * 1024 * 1024) {
              await reader.cancel();
              return failure("config", "原文请求过大，内容仍保留在本机");
            }
            parts.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        source = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch {
        return failure("config", "原文请求格式不合法，内容仍保留在本机");
      }
      const result = await service.analyze(source, "smoke", request.signal);
      return Response.json(result.response, {
        headers: {
          "Cache-Control": "no-store",
          "X-JDelight-Receipts": JSON.stringify(result.receipts),
        },
      });
    },
  };
}
