import {
  answerInputSchema,
  modelAnswerSchema,
  type AnswerInput,
  type AnswerResponse,
} from "@/domain/answer";
import { AnalysisClientError } from "./client";
import { inviteHeaders } from "./invite";
export async function answerWithModel(input: AnswerInput, signal: AbortSignal) {
  const source = answerInputSchema.safeParse(input);
  if (!source.success)
    throw new AnalysisClientError("check", [
      "提问或选中文字过长，请缩小范围后重试。",
    ]);
  let response: Response;
  try {
    response = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...inviteHeaders() },
      body: JSON.stringify(source.data),
      signal,
    });
  } catch {
    throw new AnalysisClientError("network", ["没有拿到解答，这次不扣次数。"]);
  }
  let data: AnswerResponse;
  try {
    data = await response.json();
  } catch {
    throw new AnalysisClientError("network", ["没有拿到解答，这次不扣次数。"]);
  }
  if (!data || data.ok !== true) {
    throw new AnalysisClientError(
      data && ["check", "quota", "network", "config"].includes(data.kind)
        ? data.kind
        : "network",
      Array.isArray(data?.reasons)
        ? data.reasons.filter((reason) => typeof reason === "string")
        : ["没有拿到解答，这次不扣次数。"],
    );
  }
  const answer = modelAnswerSchema.safeParse({
    answer: data.answer,
    kind: data.kind,
  });
  if (
    !answer.success ||
    !Number.isInteger(data.questionsRemaining) ||
    data.questionsRemaining < 0 ||
    data.questionsRemaining > 20
  )
    throw new AnalysisClientError("check", ["解答格式不正确，请稍后重试。"]);
  return {
    answer: answer.data.answer,
    answerKind: answer.data.kind,
    questionsRemaining: data.questionsRemaining,
  };
}
