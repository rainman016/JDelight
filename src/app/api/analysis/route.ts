import { createHandlers } from "@/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createHandlers().POST;
