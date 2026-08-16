import { NextResponse } from "next/server";
import { all, id, nowIso, run } from "@/lib/db";
import { HttpError, loadActor } from "@/lib/permissions";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userId } = (await req.json()) as { userId: string };
    const actor = await loadActor(userId);

    const rows = await all<{ n: number }>(
      `SELECT COALESCE(MAX(seq), 0) AS n FROM sessions WHERE user_id = ?`,
      [actor.user.id],
    );
    const seq = Number(rows[0]?.n ?? 0) + 1;
    const sessionId = id("s");
    await run(
      `INSERT INTO sessions (id, user_id, title, seq, created_at) VALUES (?,?,?,?,?)`,
      [sessionId, actor.user.id, `Chat session #${seq} — New chat`, seq, nowIso()],
    );

    return NextResponse.json(await loadState(actor.user.id, sessionId));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
