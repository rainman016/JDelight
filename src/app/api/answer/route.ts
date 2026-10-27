import { createAnswerHandlers } from "@/server/answer-api";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createAnswerHandlers().POST;
