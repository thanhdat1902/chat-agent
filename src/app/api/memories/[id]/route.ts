import { NextResponse } from "next/server";
import { getMemoryAs, HttpError, loadActor, visibilityClause } from "@/lib/permissions";
import { correctMemory, deleteMemory } from "@/lib/memory";
import { loadState } from "@/lib/state";
import type { Scope } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET is also the leak probe used by the UI's "try to leak it" panel: ask for
 * a known memory id *as a different user* and watch it 404. The response
 * echoes the exact SQL predicate that produced the answer, so a reviewer can
 * see where the check lives without reading the source.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const userId = new URL(req.url).searchParams.get("userId") ?? "";
    const actor = await loadActor(userId);
    const memory = await getMemoryAs(actor, id);
    const clause = visibilityClause(actor);

    if (!memory) {
      return NextResponse.json(
        {
          allowed: false,
          actor: actor.user.name,
          teams: actor.teamNames,
          reason:
            "No row matched. The memory either does not exist or is out of scope for this user — deliberately indistinguishable.",
          predicate: clause.sql.replace(/\s+/g, " ").trim(),
          predicateArgs: clause.args,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({
      allowed: true,
      actor: actor.user.name,
      teams: actor.teamNames,
      memory,
      predicate: clause.sql.replace(/\s+/g, " ").trim(),
      predicateArgs: clause.args,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      userId: string;
      content?: string;
      scope?: Scope;
      sessionId?: string | null;
    };
    const actor = await loadActor(body.userId);
    await correctMemory(actor, id, { content: body.content, scope: body.scope });
    return NextResponse.json(await loadState(actor.user.id, body.sessionId ?? null));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const params = new URL(req.url).searchParams;
    const actor = await loadActor(params.get("userId") ?? "");
    await deleteMemory(actor, id);
    return NextResponse.json(await loadState(actor.user.id, params.get("sessionId")));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
