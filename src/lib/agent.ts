import { activeProvider, completeText } from "./llm";
import { precedence } from "./memory";
import { listVisibleDocuments } from "./permissions";
import type { Actor, Doc, Memory, Message, RetrievalResult } from "./types";

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
const scopeTag = (d: Doc, teamName: string) =>
  d.scope === "org" ? "ORG" : d.scope === "team" ? `TEAM · ${teamName}` : "PERSONAL";

/**
 * Reference material the answer may cite. These arrive already filtered by the
 * same scope predicate that filters memories — so a Finance pricing sheet is
 * simply absent from an Operations prompt, exactly as a Finance rule is.
 *
 * The prompt says plainly that the set is scoped and may be incomplete, so the
 * agent says "I don't have that" rather than inventing the missing figures.
 */
function documentBlock(docs: Doc[], teamName: string): string {
  if (docs.length === 0) return "";
  const sections = docs
    .map((d) => `### ${d.title}  [${scopeTag(d, teamName)}]\n${d.summary}\n\n${d.body}`)
    .join("\n\n");
  return `

REFERENCE DOCUMENTS
These are the documents you have access to. Cite figures from them rather than inventing any.
This set is scoped to you and may not be everything that exists in the company — if answering
needs a document you do not have here, say what is missing and that it needs to come from
whoever owns it. Do not guess at its contents.

${sections}`;
}

export function buildSystemPrompt(
  actor: Actor,
  retrieval: RetrievalResult,
  authors: Map<string, string>,
  docs: Doc[] = [],
): string {
  const teamName = actor.teamNames[0] ?? "no team";
  const header = `You are the workplace assistant for ${actor.user.name} (${actor.user.role}), on the ${teamName} team.

Answer the way a sharp colleague would: get to the point, be concrete, and use the team's own vocabulary. Keep replies short unless the question needs depth.`;

  const book = documentBlock(docs, teamName);

  if (retrieval.injected.length === 0) {
    return `${header}${book}\n\nNo standing rules apply to this conversation yet.`;
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

  return `${header}${book}

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
  const system = buildSystemPrompt(actor, retrieval, authors, await listVisibleDocuments(actor));

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
