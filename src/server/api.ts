import "server-only";
import { analysisService, type createAnalysisService } from "./analysis.ts";
import { readTrialMode } from "./trial-config.ts";
import {
  createTrialService,
  unavailableTrialStatus,
  type TrialOptions,
} from "./trial-analysis.ts";
import { checkInvite } from "./invite.ts";
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
function trialRequest(request: Request, allowed: string[], post: boolean) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  if (!allowed.includes(host)) return false;
  const origin = request.headers.get("origin");
  if (!post && !origin) return true;
  try {
    if (!origin) return false;
    const parsed = new URL(origin);
    return (
      origin === parsed.origin &&
      parsed.host === host &&
      parsed.protocol === new URL(request.url).protocol
    );
  } catch {
    return false;
  }
}
export function createHandlers(
  service: Service = analysisService,
  options: TrialOptions & { env?: Record<string, string | undefined> } = {},
) {
  return {
    async GET(request: Request) {
      const trial = readTrialMode(options.env);
      if (trial.enabled) {
        if (!trial.config)
          return Response.json(unavailableTrialStatus(), {
            status: 403,
            headers: { "Cache-Control": "no-store" },
          });
        if (
          !trial.config ||
          !trialRequest(request, trial.config.allowedHosts, false)
        )
          return failure("config", "试用配置未就绪或请求来源不受允许", 403);
        return Response.json(
          await createTrialService(trial.config, options).status(
            request.headers.get("X-JDelight-Invite"),
          ),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (!localRequest(request))
        return failure("config", "仅允许本机同源请求", 403);
      return Response.json(await service.status(), {
        headers: { "Cache-Control": "no-store" },
      });
    },
    async POST(request: Request) {
      const trial = readTrialMode(options.env);
      if (
        trial.enabled &&
        (!trial.config ||
          !trialRequest(request, trial.config.allowedHosts, true))
      )
        return failure("config", "试用配置未就绪或请求来源不受允许", 403);
      if (!trial.enabled && !localRequest(request))
        return failure("config", "仅允许本机同源请求", 403);
      if (
        trial.enabled
          ? request.headers
              .get("content-type")
              ?.split(";")[0]
              .trim()
              .toLowerCase() !== "application/json"
          : !request.headers
              .get("content-type")
              ?.toLowerCase()
              .startsWith("application/json")
      )
        return failure("config", "请求需要 JSON 格式");
      if (
        trial.enabled &&
        trial.config &&
        !checkInvite(
          request.headers.get("X-JDelight-Invite"),
          trial.config.hashes,
        )
      )
        return failure("config", "邀请码缺失或不对，请检查后重试。", 403);
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
      const result =
        trial.enabled && trial.config
          ? await createTrialService(trial.config, options).analyze(
              source,
              request.headers.get("X-JDelight-Invite"),
              request.signal,
            )
          : await service.analyze(source, "smoke", request.signal);
      return Response.json(result.response, {
        headers: {
          "Cache-Control": "no-store",
          "X-JDelight-Receipts": JSON.stringify(result.receipts),
        },
      });
    },
  };
}
