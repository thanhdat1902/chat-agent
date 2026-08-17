import { NextResponse } from "next/server";
import { HttpError, loadActor } from "@/lib/permissions";
import { deleteSession } from "@/lib/sessions";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const params = new URL(req.url).searchParams;
    const actor = await loadActor(params.get("userId") ?? "");
    await deleteSession(actor, id);

    // Fall back to the actor's first remaining session, or none if that was
    // the last one — loadState handles a null/unknown id.
    const keep = params.get("sessionId");
    return NextResponse.json(await loadState(actor.user.id, keep === id ? null : keep));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
