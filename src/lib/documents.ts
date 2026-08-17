import { listVisibleDocuments } from "./permissions";
import { overlap, tokens } from "./memory";
import type { Actor, Doc } from "./types";

/** How many document bodies may enter a single prompt. */
export const DOC_BUDGET = 2;

/** Below this, a document is listed in the index but its body is not sent. */
export const DOC_THRESHOLD = 0.06;

export interface DocRetrieval {
  /** Everything the actor may read — rendered as a title/summary index. */
  index: Doc[];
  /** The subset whose full contents were put in the prompt this turn. */
  injected: Doc[];
}

/**
 * DOCUMENT RETRIEVAL
 *
 * Injecting every document on every turn is the reason the agent reached for
 * internal figures on questions that did not call for them: whatever is in the
 * context gets used. Documents are now handled like memories — the actor's
 * visible set is scored against the turn, and only what is relevant has its
 * body sent. Everything else appears as a one-line index entry, so the agent
 * knows what exists and can say it needs something it was not given.
 *
 * The scoring query deliberately includes the text of the rules that were
 * injected this turn. That is what lets a rule *summon* a document: a Finance
 * rule naming the Q3 pricing sheet pulls that sheet into context, where the
 * same question without the rule would not.
 */
export async function retrieveDocuments(
  actor: Actor,
  query: string,
  ruleText = "",
): Promise<DocRetrieval> {
  const index = await listVisibleDocuments(actor);
  if (index.length === 0) return { index, injected: [] };

  const q = tokens(`${query} ${ruleText}`);
  const scored = index
    .map((d) => ({ d, score: overlap(q, tokens(`${d.title} ${d.summary} ${d.body}`)) }))
    .sort((a, b) => b.score - a.score);

  return {
    index,
    injected: scored
      .filter((s) => s.score >= DOC_THRESHOLD)
      .slice(0, DOC_BUDGET)
      .map((s) => s.d),
  };
}
