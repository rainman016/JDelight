import "server-only";
import { readTrialMode } from "./trial-config.ts";
import { trialRequest } from "./api.ts";
import { checkInvite } from "./invite.ts";
import { readJsonStream } from "./json-stream.ts";
import { createAnswerService } from "./answer.ts";
import type { TrialOptions } from "./trial-analysis.ts";
export function createAnswerHandlers(
  options: TrialOptions & { env?: Record<string, string | undefined> } = {},
) {
  const failure = (reason: string, status = 403) =>
    Response.json(
      { ok: false, kind: "config", reasons: [reason] },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  return {
    async POST(request: Request) {
      const trial = readTrialMode(options.env);
      if (
        !trial.enabled ||
        !trial.config ||
        !trialRequest(request, trial.config.allowedHosts, true)
      )
        return failure("真实提问暂不可用或请求来源不受允许");
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        return failure("请求需要 JSON 格式", 400);
      const code = request.headers.get("X-JDelight-Invite");
      if (!checkInvite(code, trial.config.hashes))
        return failure("邀请码缺失或不对，请检查后重试。");
      let input: unknown;
      try {
        input = await readJsonStream(request.body, 2 * 1024 * 1024);
      } catch {
        return failure("提问请求格式不合法或内容过大，问题仍保留在本机", 400);
      }
      return Response.json(
        await createAnswerService(trial.config, options).answer(
          input,
          code,
          request.signal,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    },
  };
}
