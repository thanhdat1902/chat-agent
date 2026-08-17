import { one, run } from "./db";
import { HttpError } from "./permissions";
import type { Actor, ChatSession } from "./types";

/**
 * Deleting a chat removes the transcript, not the knowledge.
 *
 * Memories extracted from the conversation survive: a rule that was ratified
 * at team or organization scope is something colleagues now depend on, and
 * letting one person silently revoke it by tidying their own chat history
 * would be a nasty failure mode. The memory keeps its quoted span, rationale,
 * and audit trail, so its provenance is still readable after the source
 * conversation is gone; removing a rule is a separate, explicit act in the
 * memory inspector.
 *
 * Unlike memories, sessions are not secret — every user's chats are listed in
 * the sidebar by design — so an attempt on someone else's session is a 403
 * rather than the 404 the memory routes return.
 */
export async function deleteSession(actor: Actor, sessionId: string): Promise<void> {
  const session = await one<ChatSession>(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
  if (!session) throw new HttpError(404, "That chat no longer exists.");
  if (session.user_id !== actor.user.id) {
    throw new HttpError(403, "You can only delete your own chats.");
  }

  // Drop the links from this session's messages first so no orphan rows are
  // left pointing at messages that no longer exist.
  await run(
    `DELETE FROM message_memories
      WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)`,
    [sessionId],
  );
  await run(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
  await run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}
