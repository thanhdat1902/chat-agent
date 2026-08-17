import { activeProvider, completeJson } from "./llm";
import type { Actor, ExtractedRule, Memory, Scope } from "./types";

/**
 * ============================================================================
 * RULE EXTRACTION + SCOPE ASSIGNMENT
 * ============================================================================
 * Every user turn is passed through an extractor. It answers two questions:
 *
 *   1. Does this message contain a durable instruction (a rule), as opposed to
 *      a one-off request, a question, or small talk?
 *   2. If so, who does it bind — this person, their team, or the whole org?
 *
 * Scope is decided from the *language of the request*, not from who is
 * speaking. The signal hierarchy the model is given:
 *
 *   ORG      explicit universality: "everyone", "company-wide", "all teams",
 *            "we never ...", "as a company", "across the board".
 *   TEAM     explicit team reference: "we in finance", "our team", "on the
 *            finance side", "for renewals" (a team's domain of work).
 *   PERSONAL first person singular framing about how the agent should treat
 *            *this* user: "give me ...", "I prefer ...", "when you answer me".
 *
 * When those signals conflict or are absent, we do NOT guess wide. The
 * extractor returns its best scope with a confidence, and anything below 0.7
 * — plus every org-scoped rule regardless of confidence — is written as
 * `pending`: visible only to the author, injected into nobody's prompt, and
 * surfaced in the UI as a one-click confirmation. Guessing wrong therefore
 * costs a click, never a leak.
 * ============================================================================
 */

const RULE_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      description:
        "Durable instructions found in the message. Empty when the message contains none.",
      items: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The rule as a standalone imperative sentence that will still make sense months later, with no reference to 'this message' or 'above'.",
          },
          scope: {
            type: "string",
            enum: ["personal", "team", "org"],
          },
          scope_confidence: {
            type: "number",
            description:
              "0-1. How clearly the message itself signals that scope. Use <0.7 when you are inferring rather than reading an explicit signal.",
          },
          key: {
            type: "string",
            description:
              "Short dotted category so competing rules collide, e.g. format.style, tone.emoji, pricing.source, policy.dates, comms.signoff.",
          },
          rationale: {
            type: "string",
            description: "One sentence: which words in the message drove the scope choice.",
          },
          quote: {
            type: "string",
            description: "The exact span of the user's message the rule came from.",
          },
          supersedes_id: {
            type: "string",
            description:
              "Id of an existing memory this replaces or contradicts, or empty string if none.",
          },
        },
        required: [
          "content",
          "scope",
          "scope_confidence",
          "key",
          "rationale",
          "quote",
          "supersedes_id",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["rules"],
  additionalProperties: false,
} as const;

function extractionSystemPrompt(actor: Actor, existing: Memory[]): string {
  const team = actor.teamNames[0] ?? "(no team)";
  const known = existing.length
    ? existing
        .map((m) => `- [${m.id}] (${m.scope}${m.binding ? ", binding" : ""}, key=${m.key}) ${m.content}`)
        .join("\n")
    : "(none yet)";

  return `You extract durable rules from workplace chat so an agent can follow them later without being reminded.

The speaker is ${actor.user.name} (${actor.user.role}), team: ${team}.

WHAT COUNTS AS A RULE
A rule is a standing instruction about how work should be done or how the agent should behave. It applies beyond the current message.
NOT rules: questions, one-off task requests ("draft this email"), factual statements, opinions, small talk, or the user reacting to your last answer.
"Summarise this doc" is a task. "Always summarise docs as bullets" is a rule.

SCOPE DECISION — read the language, not the speaker's seniority.
- org: the message explicitly generalises to everyone — "that goes for everyone", "company-wide", "we never ...", "all teams", "across the board", "as a company".
- team: the message references the team or the team's domain of work — "our team", "we in finance", "for renewals", "on the ops side".
- personal: first-person framing about how the agent should treat this user — "give me ...", "I prefer ...", "when you write to me".

If the message carries no explicit signal, choose the NARROWEST scope that could be right and set scope_confidence below 0.7. Never widen on a hunch: an over-wide guess is corrected by a human, but only after it has already been proposed, so it must be flagged as uncertain.
Someone can only set a team rule for their own team (${team}). If they name a different team, treat it as personal with low confidence and say so in the rationale.

KEYS — THIS IS HOW CONFLICTS ARE DETECTED
The key groups rules that answer the same question. Two rules sharing a key are treated as competing, and a precedence ladder decides which one applies; two rules with different keys both apply. So the key is not a label, it is a claim about what the rule governs.

Already stored and visible to this user:
${known}

If the new rule governs the same aspect of behaviour as one of those — response format, which pricing source to use, committing dates, tone, who must approve something — reuse that memory's EXACT key, character for character. Do this even when the new rule does not replace the old one and even when the two are compatible. "Reply in bullets" and "end with a summary paragraph" both govern response format and must share a key; if they did not, both would be applied and the disagreement would never surface.

Only invent a new key for genuinely new territory. Prefer a short dotted form: format.style, pricing.source, policy.dates, comms.tone, approval.threshold.

SUPERSESSION
If the new rule contradicts or updates a stored one so that the old one should stop applying entirely, put that memory's id in supersedes_id. Otherwise use an empty string — sharing a key is enough for the ladder to arbitrate; supersession is for retiring a rule outright. Do not re-extract a rule already stored in the same form; return it only if the wording meaningfully changes it.

Return only the rules you actually find. Most messages contain zero. Returning nothing is the correct and common answer.`;
}

export async function extractRules(
  actor: Actor,
  message: string,
  existing: Memory[],
): Promise<ExtractedRule[]> {
  if (activeProvider() === "none") return heuristicExtract(actor, message);

  try {
    const parsed = await completeJson<{ rules: ExtractedRule[] }>(
      extractionSystemPrompt(actor, existing),
      message,
      "extracted_rules",
      RULE_SCHEMA as unknown as Record<string, unknown>,
    );
    return (parsed?.rules ?? []).map(normalise);
  } catch (err) {
    console.error("[extract] model call failed, falling back to heuristics:", err);
    return heuristicExtract(actor, message);
  }
}

function normalise(r: ExtractedRule): ExtractedRule {
  const scope: Scope = ["personal", "team", "org"].includes(r.scope) ? r.scope : "personal";
  return {
    ...r,
    scope,
    scope_confidence: Math.min(1, Math.max(0, Number(r.scope_confidence) || 0.5)),
    key: (r.key || "general").toLowerCase().replace(/\s+/g, "."),
    supersedes_id: r.supersedes_id ? r.supersedes_id : null,
  };
}

/**
 * Deterministic fallback so the app is fully demonstrable without an API key
 * (and so an API outage degrades rather than breaks). Same scope signals as
 * the prompt above, expressed as patterns.
 */
const ORG_SIGNALS =
  /\b(everyone|company[- ]wide|org[- ]wide|all teams|across the board|as a company|whole company|we never|we always|nobody should|no one should)\b/i;
const TEAM_SIGNALS =
  /\b(our team|my team|the team|we in \w+|finance side|ops side|for renewals|on our side|team-wide)\b/i;
const PERSONAL_SIGNALS =
  /\b(give me|i prefer|i like|i want|for me|when you (answer|reply|write) me|my preference|don'?t give me)\b/i;
const RULE_SIGNALS =
  /\b(always|never|from now on|going forward|stop|don'?t|do not|must|should|make sure|remember to|by default|prefer)\b/i;

export function heuristicExtract(actor: Actor, message: string): ExtractedRule[] {
  const text = message.trim();
  if (!RULE_SIGNALS.test(text)) return [];
  if (text.endsWith("?") && !ORG_SIGNALS.test(text)) return [];

  let scope: Scope = "personal";
  let confidence = 0.5;
  let rationale = "No explicit scope signal — defaulted to the narrowest scope.";

  if (ORG_SIGNALS.test(text)) {
    scope = "org";
    confidence = 0.9;
    rationale = `Message generalises beyond the speaker ("${text.match(ORG_SIGNALS)?.[0]}").`;
  } else if (TEAM_SIGNALS.test(text) && actor.teamIds.length > 0) {
    scope = "team";
    confidence = 0.85;
    rationale = `Message references the team ("${text.match(TEAM_SIGNALS)?.[0]}").`;
  } else if (PERSONAL_SIGNALS.test(text)) {
    scope = "personal";
    confidence = 0.85;
    rationale = `First-person framing ("${text.match(PERSONAL_SIGNALS)?.[0]}").`;
  }

  return [
    {
      content: text.replace(/^(hey|hi|ok|okay|also|and)[,\s]+/i, "").replace(/\s+/g, " "),
      scope,
      scope_confidence: confidence,
      key: guessKey(text),
      rationale: `${rationale} (Heuristic extractor — no model key set.)`,
      quote: text.slice(0, 240),
      supersedes_id: null,
    },
  ];
}

function guessKey(text: string): string {
  const t = text.toLowerCase();
  if (/emoji/.test(t)) return "tone.emoji";
  if (/bullet|paragraph|concise|brief|format/.test(t)) return "format.style";
  if (/price|pricing|quote|rate card|discount/.test(t)) return "pricing.source";
  if (/date|timeline|deadline|ship|eta/.test(t)) return "policy.dates";
  if (/sign[- ]off|approval|approve/.test(t)) return "policy.signoff";
  return "general.rule";
}
