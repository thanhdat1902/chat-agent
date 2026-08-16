import { NextResponse } from "next/server";
import { HttpError, loadActor } from "@/lib/permissions";
import { confirmMemory } from "@/lib/memory";
import { loadState } from "@/lib/state";
import type { Scope } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Ratification. Until this runs, an org-scoped or low-confidence memory is
 * `pending`: visible only to its author and injected into nobody's prompt.
 * This is what "org rules require confirmation before binding everyone" and
 * "what happens when the agent guesses the scope wrong" both resolve to.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      userId: string;
      accept: boolean;
      scope?: Scope;
      binding?: boolean;
      sessionId?: string | null;
    };
    const actor = await loadActor(body.userId);
    await confirmMemory(actor, id, {
      accept: body.accept,
      scope: body.scope,
      binding: body.binding,
    });
    return NextResponse.json(await loadState(actor.user.id, body.sessionId ?? null));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
