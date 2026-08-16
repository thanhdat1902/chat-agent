import { NextResponse } from "next/server";
import { all, id, nowIso, one, run } from "@/lib/db";
import { HttpError, listVisibleMemories, loadActor } from "@/lib/permissions";
import { persistExtraction, retrieveForTurn } from "@/lib/memory";
import { extractRules } from "@/lib/extract";
import { generateReply } from "@/lib/agent";
import { loadState } from "@/lib/state";
import type { ChatSession, User } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { userId, sessionId, content } = (await req.json()) as {
      userId: string;
      sessionId: string;
      content: string;
    };
    if (!content?.trim()) throw new HttpError(400, "Empty message.");

    const actor = await loadActor(userId);

    // You may only speak into your own session.
    const session = await one<ChatSession>(
      `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      [sessionId, userId],
    );
    if (!session) throw new HttpError(403, "That session does not belong to this user.");

    // 1. Record the turn.
    const userMessageId = id("msg");
    await run(
      `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`,
      [userMessageId, sessionId, "user", content.trim(), nowIso()],
    );

    // 2. Extraction — does this turn contain a durable rule, and at what scope?
    //    Runs against the memories this user can already see, so it can detect
    //    supersession without being shown anything they are not entitled to.
    const known = await listVisibleMemories(actor);
    const rules = await extractRules(actor, content.trim(), known);
    const created = await persistExtraction(actor, rules, sessionId, userMessageId);
    for (const m of created) {
      await run(
        `INSERT INTO message_memories (message_id, memory_id, relation) VALUES (?,?,?)`,
        [userMessageId, m.id, "created"],
      );
    }

    // 3. Retrieval happens after extraction, so a rule stated in this very turn
    //    takes effect immediately — provided it was ratified (personal/team,
    //    high confidence). Org and low-confidence rules stay pending.
    const history = await all<{ role: "user" | "assistant"; content: string }>(
      `SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
      [sessionId],
    );
    const recent = history
      .slice(-6)
      .map((m) => m.content)
      .join(" ");
    const retrieval = await retrieveForTurn(actor, content, recent);

    // 4. Generate.
    const users = await all<User>(`SELECT id, name FROM users`);
    const authors = new Map(users.map((u) => [u.id, u.name]));
    const reply = await generateReply(
      actor,
      history.map((h, i) => ({
        id: `h${i}`,
        session_id: sessionId,
        role: h.role,
        content: h.content,
        created_at: "",
        used_memory_ids: [],
        created_memory_ids: [],
      })),
      retrieval,
      authors,
    );

    // 5. Record which memories shaped the answer.
    const assistantMessageId = id("msg");
    await run(
      `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`,
      [assistantMessageId, sessionId, "assistant", reply, nowIso()],
    );
    for (const m of retrieval.injected) {
      await run(
        `INSERT INTO message_memories (message_id, memory_id, relation) VALUES (?,?,?)`,
        [assistantMessageId, m.id, "used"],
      );
    }

    // Give the session a real title once it has content.
    if (session.title.includes("New chat")) {
      const title = `Chat session #${session.seq} — ${content.trim().slice(0, 38)}${
        content.trim().length > 38 ? "…" : ""
      }`;
      await run(`UPDATE sessions SET title = ? WHERE id = ?`, [title, sessionId]);
    }

    const state = await loadState(userId, sessionId);
    return NextResponse.json({
      state,
      retrieval: {
        injected: retrieval.injected.map((m) => m.id),
        overridden: retrieval.overridden.map((o) => ({
          id: o.memory.id,
          beatenBy: o.beatenBy,
        })),
        droppedForBudget: retrieval.droppedForBudget.map((m) => m.id),
        visibleCount: retrieval.visibleCount,
      },
      createdMemoryIds: created.map((m) => m.id),
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    console.error("[chat]", err);
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
