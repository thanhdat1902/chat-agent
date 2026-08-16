import { NextResponse } from "next/server";
import { loadState } from "@/lib/state";
import { HttpError } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") ?? "u_ryan";
  const sessionId = url.searchParams.get("sessionId");
  try {
    return NextResponse.json(await loadState(userId, sessionId));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
