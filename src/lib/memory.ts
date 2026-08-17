import { all, id, nowIso, run } from "./db";
import {
  assertCanMutate,
  assertCanWrite,
  getMemoryAs,
  HttpError,
  listRetrievableMemories,
  ORG_ID,
  requireMemory,
} from "./permissions";
import type {
  Actor,
  ExtractedRule,
  Memory,
  MemoryEvent,
  OverriddenMemory,
  RetrievalResult,
  Scope,
} from "./types";

/** How many memories may enter a single prompt. Keeps context lean. */
export const CONTEXT_BUDGET = 12;

/**
 * PRECEDENCE MODEL — specificity wins, with one carve-out.
 *
 *   binding org policy (4)  >  personal (3)  >  team (2)  >  org default (1)
 *
 * Rationale: the person closest to the situation has the most context, so a
 * personal preference beats a team default and a team default beats an org
 * default. The carve-out exists because some org rules are not defaults at
 * all — they are commitments the company has made ("no dates without eng
 * sign-off"). Those are flagged `binding` when they are ratified, and no
 * narrower scope can override them. Without the carve-out, "personal wins"
 * would let any user opt out of compliance by stating a preference.
 */
export function precedence(m: Memory): number {
  if (m.scope === "org" && m.binding) return 4;
  if (m.scope === "personal") return 3;
  if (m.scope === "team") return 2;
  return 1;
}

export const PRECEDENCE_LADDER = [
  { rank: 4, label: "Org policy (binding)", note: "Cannot be overridden by anyone." },
  { rank: 3, label: "Personal", note: "Beats team and org defaults." },
  { rank: 2, label: "Team", note: "Beats org defaults." },
  { rank: 1, label: "Org default", note: "Applies when nothing narrower says otherwise." },
];

const STOPWORDS = new Set(
  "the a an and or but if to of for with on in at is are be do you your we our i me my it that this how what when should can please just".split(
    " ",
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return hits / Math.sqrt(a.size * b.size);
}

function recencyBoost(iso: string): number {
  const ageDays = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return Math.max(0, 1 - ageDays / 120) * 0.5;
}

export function scoreMemory(m: Memory, queryTokens: Set<string>): number {
  return (
    precedence(m) * 1.0 +
    m.confidence * 1.0 +
    overlap(queryTokens, tokens(`${m.content} ${m.key}`)) * 4.0 +
    recencyBoost(m.created_at)
  );
}

/**
 * RETRIEVAL
 *
 * 1. Pull only what this actor may see (SQL-enforced, see permissions.ts).
 * 2. Score against the current turn + recent conversation, so we do not stuff
 *    everything into context. Behavioural rules are few and cheap, but the
 *    ranking is what keeps this from degrading as the store grows.
 * 3. Resolve conflicts by `key` using the precedence ladder. Losers are
 *    reported (and shown in the UI) but never injected — the model is not
 *    asked to arbitrate between contradictory instructions.
 * 4. Cap at CONTEXT_BUDGET; anything dropped is reported rather than silently
 *    truncated.
 */
export async function retrieveForTurn(
  actor: Actor,
  query: string,
  recentContext = "",
): Promise<RetrievalResult> {
  const visible = await listRetrievableMemories(actor);
  const q = tokens(`${query} ${recentContext}`);

  const ranked = visible
    .map((m) => ({ m, score: scoreMemory(m, q) }))
    .sort((a, b) => b.score - a.score);

  // --- conflict resolution by key -----------------------------------------
  const byKey = new Map<string, Memory[]>();
  for (const { m } of ranked) {
    const list = byKey.get(m.key) ?? [];
    list.push(m);
    byKey.set(m.key, list);
  }

  const winners: Memory[] = [];
  const overridden: OverriddenMemory[] = [];
  for (const [, group] of byKey) {
    if (group.length === 1) {
      winners.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const p = precedence(b) - precedence(a);
      if (p !== 0) return p;
      return b.created_at.localeCompare(a.created_at); // newer wins a tie
    });
    const [winner, ...losers] = sorted;
    winners.push(winner);
    for (const l of losers) {
      overridden.push({
        memory: l,
        beatenBy: winner.id,
      });
    }
  }

  const winnersRanked = winners
    .map((m) => ({ m, score: scoreMemory(m, q) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);

  return {
    injected: winnersRanked.slice(0, CONTEXT_BUDGET),
    overridden,
    droppedForBudget: winnersRanked.slice(CONTEXT_BUDGET),
    visibleCount: visible.length,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function logEvent(
  memoryId: string,
  actorId: string,
  action: string,
  detail = "",
): Promise<void> {
  await run(
    `INSERT INTO memory_events (id, memory_id, actor_user_id, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id("evt"), memoryId, actorId, action, detail, nowIso()],
  );
}

export async function memoryEvents(memoryId: string): Promise<MemoryEvent[]> {
  return all<MemoryEvent>(
    `SELECT * FROM memory_events WHERE memory_id = ? ORDER BY created_at ASC`,
    [memoryId],
  );
}

export interface WriteMemoryInput {
  scope: Scope;
  key: string;
  content: string;
  confidence: number;
  rationale: string;
  quote: string;
  sessionId: string | null;
  messageId: string | null;
  supersedesId?: string | null;
  /** Overrides the default status decision (used by the seed). */
  forceStatus?: Memory["status"];
  binding?: boolean;
  createdAt?: string;
}

/**
 * SCOPE RATIFICATION
 *
 * A rule is stored `active` when we are confident about its scope and it is
 * not org-wide. It is stored `pending` when either:
 *   - it is org-scoped (an org rule binds four people, so a human confirms it
 *     before it reaches anyone else), or
 *   - scope confidence is below 0.7 (the model guessed).
 *
 * `pending` rows are only visible to their author (enforced in SQL), so an
 * unconfirmed or mis-scoped rule can never leak into another user's agent
 * while it waits for a decision.
 */
export function decideStatus(scope: Scope, confidence: number): Memory["status"] {
  if (scope === "org") return "pending";
  if (confidence < 0.7) return "pending";
  return "active";
}

/**
 * Supersession carries the authority of a write: retiring a memory removes it
 * from retrieval for everyone it applied to, and a superseded row never
 * reaches the precedence ladder at all. So it cannot be granted on the
 * extractor's say-so — a model that decides a personal preference "replaces"
 * a company policy would otherwise disable that policy org-wide.
 *
 * A memory may only supersede one at its own scope, that the actor could have
 * authored, and never a binding org policy. Anything else is ignored rather
 * than thrown: both memories are kept and the precedence ladder arbitrates,
 * which is the safe outcome. The refusal is recorded in the audit trail.
 */
async function permittedSupersession(
  actor: Actor,
  scope: Scope,
  supersedesId: string | null | undefined,
): Promise<{ allowed: string | null; refused: string | null; reason: string }> {
  if (!supersedesId) return { allowed: null, refused: null, reason: "" };

  const target = await getMemoryAs(actor, supersedesId);
  if (!target) {
    return { allowed: null, refused: supersedesId, reason: "target not visible to this user" };
  }
  if (target.binding) {
    return {
      allowed: null,
      refused: supersedesId,
      reason: "target is a binding organization policy and cannot be retired this way",
    };
  }
  if (target.scope !== scope) {
    return {
      allowed: null,
      refused: supersedesId,
      reason: `a ${scope} memory cannot supersede a ${target.scope} memory`,
    };
  }
  if (scope === "team" && !actor.teamIds.includes(target.team_id ?? "")) {
    return { allowed: null, refused: supersedesId, reason: "target belongs to another team" };
  }
  if (scope === "personal" && target.owner_user_id !== actor.user.id) {
    return { allowed: null, refused: supersedesId, reason: "target belongs to another user" };
  }
  return { allowed: supersedesId, refused: null, reason: "" };
}

export async function writeMemory(
  actor: Actor,
  input: WriteMemoryInput,
): Promise<Memory> {
  const teamId = input.scope === "team" ? (actor.teamIds[0] ?? null) : null;
  assertCanWrite(actor, input.scope, teamId);

  const supersede = await permittedSupersession(actor, input.scope, input.supersedesId);

  const status = input.forceStatus ?? decideStatus(input.scope, input.confidence);
  const now = input.createdAt ?? nowIso();
  const memoryId = id("mem");

  await run(
    `INSERT INTO memories
       (id, scope, owner_user_id, team_id, org_id, key, content, status, binding,
        confidence, rationale, created_by, source_session_id, source_message_id,
        source_quote, created_at, updated_at, supersedes_id, proposed_scope)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      memoryId,
      input.scope,
      input.scope === "personal" ? actor.user.id : null,
      teamId,
      input.scope === "org" ? ORG_ID : null,
      input.key,
      input.content,
      status,
      input.binding ? 1 : 0,
      input.confidence,
      input.rationale,
      actor.user.id,
      input.sessionId,
      input.messageId,
      input.quote,
      now,
      now,
      supersede.allowed,
      status === "pending" ? input.scope : null,
    ],
  );

  await logEvent(
    memoryId,
    actor.user.id,
    status === "pending" ? "proposed" : "created",
    `${input.scope} · ${input.rationale}`,
  );

  if (supersede.allowed) {
    await run(`UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?`, [
      now,
      supersede.allowed,
    ]);
    await logEvent(supersede.allowed, actor.user.id, "superseded", `Replaced by ${memoryId}`);
  } else if (supersede.refused) {
    await logEvent(
      memoryId,
      actor.user.id,
      "supersession refused",
      `Wanted to replace ${supersede.refused} — ${supersede.reason}. Both kept; precedence decides.`,
    );
  }

  const created = await requireMemory(actor, memoryId);
  return created;
}

export async function persistExtraction(
  actor: Actor,
  rules: ExtractedRule[],
  sessionId: string,
  messageId: string,
): Promise<Memory[]> {
  const out: Memory[] = [];
  for (const r of rules) {
    // A user with no team cannot own a team rule; fall back to personal and say so.
    let scope = r.scope;
    let rationale = r.rationale;
    if (scope === "team" && actor.teamIds.length === 0) {
      scope = "personal";
      rationale = `${rationale} (No team membership — stored as personal instead.)`;
    }
    out.push(
      await writeMemory(actor, {
        scope,
        key: r.key,
        content: r.content,
        confidence: r.scope_confidence,
        rationale,
        quote: r.quote,
        sessionId,
        messageId,
        supersedesId: r.supersedes_id ?? null,
      }),
    );
  }
  return out;
}

export async function confirmMemory(
  actor: Actor,
  memoryId: string,
  decision: { scope?: Scope; binding?: boolean; accept: boolean },
): Promise<Memory | null> {
  const memory = await requireMemory(actor, memoryId);
  if (memory.created_by !== actor.user.id) {
    throw new HttpError(403, "Only the author can ratify a proposed memory.");
  }

  if (!decision.accept) {
    await run(`UPDATE memories SET status = 'rejected', updated_at = ? WHERE id = ?`, [
      nowIso(),
      memoryId,
    ]);
    await logEvent(memoryId, actor.user.id, "rejected", "Author declined the proposal.");
    return null;
  }

  const scope = decision.scope ?? memory.scope;
  const teamId = scope === "team" ? (actor.teamIds[0] ?? null) : null;
  assertCanWrite(actor, scope, teamId);

  await run(
    `UPDATE memories
        SET status = 'active',
            scope = ?,
            owner_user_id = ?,
            team_id = ?,
            org_id = ?,
            binding = ?,
            proposed_scope = NULL,
            confidence = 1.0,
            updated_at = ?
      WHERE id = ?`,
    [
      scope,
      scope === "personal" ? actor.user.id : null,
      teamId,
      scope === "org" ? ORG_ID : null,
      decision.binding ? 1 : memory.binding,
      nowIso(),
      memoryId,
    ],
  );
  await logEvent(
    memoryId,
    actor.user.id,
    "ratified",
    `Confirmed at ${scope} scope${decision.binding ? " (binding)" : ""}.`,
  );
  return requireMemory(actor, memoryId);
}

export async function correctMemory(
  actor: Actor,
  memoryId: string,
  patch: { content?: string; scope?: Scope },
): Promise<Memory> {
  const memory = await requireMemory(actor, memoryId);
  assertCanMutate(actor, memory);

  if (memory.scope === "org" && memory.binding && patch.scope && patch.scope !== "org") {
    throw new HttpError(
      403,
      "A binding org policy cannot be narrowed. Delete it at org level instead.",
    );
  }

  const scope = patch.scope ?? memory.scope;
  const teamId = scope === "team" ? (memory.team_id ?? actor.teamIds[0] ?? null) : null;
  assertCanWrite(actor, scope, teamId);

  const before = `${memory.scope}: ${memory.content}`;
  await run(
    `UPDATE memories
        SET content = ?, scope = ?, owner_user_id = ?, team_id = ?, org_id = ?, updated_at = ?
      WHERE id = ?`,
    [
      patch.content ?? memory.content,
      scope,
      scope === "personal" ? (memory.owner_user_id ?? actor.user.id) : null,
      teamId,
      scope === "org" ? ORG_ID : null,
      nowIso(),
      memoryId,
    ],
  );
  await logEvent(memoryId, actor.user.id, "corrected", `Was — ${before}`);
  return requireMemory(actor, memoryId);
}

export async function deleteMemory(actor: Actor, memoryId: string): Promise<void> {
  const memory = await requireMemory(actor, memoryId);
  assertCanMutate(actor, memory);
  await run(`DELETE FROM memories WHERE id = ?`, [memoryId]);
  await logEvent(memoryId, actor.user.id, "deleted", memory.content);
}
