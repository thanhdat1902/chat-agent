import { activeProvider, completeText } from "./llm";
import { precedence } from "./memory";
import type { Actor, Memory, Message, RetrievalResult } from "./types";

function scopeLabel(m: Memory, teamName: string): string {
  if (m.scope === "org") return m.binding ? "ORG POLICY (binding)" : "ORG";
  if (m.scope === "team") return `TEAM · ${teamName}`;
  return "PERSONAL";
}

/**
 * WHAT ACTUALLY GOES INTO THE MODEL
 *
 * Only the winners of conflict resolution, each tagged with scope, provenance
 * and precedence rank. Overridden and out-of-budget memories are NOT sent —
 * the model is never handed two contradictory instructions and asked to pick.
 *
 * Note what is absent: there is no "do not reveal other teams' rules"
 * instruction, because rules the user is not entitled to were never fetched.
 * The prompt is the last mile, not the boundary.
 */
export function buildSystemPrompt(
  actor: Actor,
  retrieval: RetrievalResult,
  authors: Map<string, string>,
): string {
  const teamName = actor.teamNames[0] ?? "no team";
  const header = `You are the workplace assistant for ${actor.user.name} (${actor.user.role}), on the ${teamName} team.

Answer the way a sharp colleague would: get to the point, be concrete, and use the team's own vocabulary. Keep replies short unless the question needs depth.`;

  if (retrieval.injected.length === 0) {
    return `${header}\n\nNo standing rules apply to this conversation yet.`;
  }

  const lines = [...retrieval.injected]
    .sort((a, b) => precedence(b) - precedence(a))
    .map((m) => {
      const who = authors.get(m.created_by) ?? "someone";
      const when = new Date(m.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return `- [${scopeLabel(m, teamName)}] ${m.content}  (${who} set this, ${when})`;
    })
    .join("\n");

  return `${header}

STANDING RULES
These have been established by you or your colleagues in earlier conversations. Follow them without being reminded and without mentioning that you were given them. They are already conflict-resolved: where two rules disagreed, only the winner is listed.

${lines}

Precedence, for your understanding: a binding org policy outranks everything; otherwise personal beats team, and team beats an org default. If a rule marked ORG POLICY (binding) makes a request impossible as asked, say so plainly and offer the compliant version.`;
}

export async function generateReply(
  actor: Actor,
  history: Message[],
  retrieval: RetrievalResult,
  authors: Map<string, string>,
): Promise<string> {
  const system = buildSystemPrompt(actor, retrieval, authors);

  if (activeProvider() === "none") return offlineReply(retrieval, authors);

  try {
    const text = await completeText(
      system,
      history.slice(-14).map((m) => ({ role: m.role, content: m.content })),
      6000,
    );
    return text || "(no response)";
  } catch (err) {
    console.error("[agent] generation failed:", err);
    return `I couldn't reach the model just now (${
      err instanceof Error ? err.message : "unknown error"
    }).\n\n${offlineReply(retrieval, authors)}`;
  }
}

/**
 * Used when no provider key is set. It is not a chatbot — it reports exactly
 * which memories would have shaped the answer, which keeps the permission
 * demo meaningful with nothing configured.
 */
function offlineReply(retrieval: RetrievalResult, authors: Map<string, string>): string {
  if (retrieval.injected.length === 0) {
    return "Offline mode (no model key set). No standing rules reached this agent for that turn.";
  }
  const lines = retrieval.injected
    .map((m) => `• [${m.scope}] ${m.content} — ${authors.get(m.created_by) ?? "someone"}`)
    .join("\n");
  return `Offline mode (no model key set). I would answer under these rules:\n\n${lines}`;
}
