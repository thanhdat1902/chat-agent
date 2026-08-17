import type { InValue } from "@libsql/client";
import { all, one } from "./db";
import type { Actor, Doc, Memory, Scope, User } from "./types";

/** Single organization in this prototype; the column exists so the boundary is real. */
export const ORG_ID = "org_main";

/**
 * ============================================================================
 * THE PERMISSION BOUNDARY
 * ============================================================================
 * Everything in this file is server-only. There is exactly one function that
 * turns "who is asking" into "which rows may they see" — `visibilityClause` —
 * and every read path in the app (agent retrieval, the memory inspector, the
 * single-memory fetch, edit, delete) is built on top of it. There is no code
 * path that reads the `memories` table without it.
 *
 * The check is a SQL WHERE clause, not a prompt instruction. A leaked Finance
 * rule would require the row to come back from SQLite in the first place; the
 * model is never given memories it could then be talked into revealing,
 * because they are not in its context at all.
 *
 * Writes are checked separately by `assertCanWrite`: you may only author a
 * team memory for a team you belong to, and org memories land as `pending`
 * until ratified (see memory.ts).
 * ============================================================================
 */

export async function loadActor(userId: string): Promise<Actor> {
  const user = await one<User>(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) throw new HttpError(404, `Unknown user '${userId}'`);
  const teams = await all<{ id: string; name: string }>(
    `SELECT t.id, t.name FROM teams t
       JOIN team_members m ON m.team_id = t.id
      WHERE m.user_id = ?
      ORDER BY t.name`,
    [userId],
  );
  return {
    user,
    teamIds: teams.map((t) => t.id),
    teamNames: teams.map((t) => t.name),
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Clause {
  sql: string;
  args: InValue[];
}

/**
 * The one and only visibility rule.
 *
 *   org      -> everyone in the organization
 *   team     -> members of that team only
 *   personal -> the owner only
 *
 * Plus: `pending` memories (unratified org proposals, ambiguous scopes) are
 * visible only to their author, so an unconfirmed org rule never reaches
 * anyone else's agent or inspector.
 */
/**
 * The scope rule on its own, with no table-specific columns beyond scope /
 * team_id / owner_user_id. Memories and documents are different kinds of
 * knowledge but they answer to exactly the same boundary — this is the single
 * definition both are built from, so there is no second implementation to
 * drift.
 */
export function scopePredicate(actor: Actor, alias = "m"): Clause {
  const a = alias;
  const teamPlaceholders = actor.teamIds.map(() => "?").join(", ");
  const teamPredicate = actor.teamIds.length
    ? `(${a}.scope = 'team' AND ${a}.team_id IN (${teamPlaceholders}))`
    : `(1 = 0)`; // no team membership -> no team rows, ever

  return {
    sql: `(
        ${a}.scope = 'org'
        OR ${teamPredicate}
        OR (${a}.scope = 'personal' AND ${a}.owner_user_id = ?)
      )`,
    args: [...actor.teamIds, actor.user.id],
  };
}

/** The scope rule plus the memory-only guard that hides unratified proposals. */
export function visibilityClause(actor: Actor, alias = "m"): Clause {
  const scope = scopePredicate(actor, alias);
  return {
    sql: `(${scope.sql} AND (${alias}.status <> 'pending' OR ${alias}.created_by = ?))`,
    args: [...scope.args, actor.user.id],
  };
}

/** Every memory the actor is entitled to see, in any status. */
export async function listVisibleMemories(actor: Actor): Promise<Memory[]> {
  const v = visibilityClause(actor);
  const rows = await all<Memory & { binding: number }>(
    `SELECT m.* FROM memories m
      WHERE ${v.sql} AND m.status <> 'rejected'
      ORDER BY m.created_at DESC`,
    v.args,
  );
  return rows;
}

/** Memories eligible for injection into a prompt: visible AND ratified. */
export async function listRetrievableMemories(actor: Actor): Promise<Memory[]> {
  const v = visibilityClause(actor);
  return all<Memory>(
    `SELECT m.* FROM memories m
      WHERE ${v.sql} AND m.status = 'active'
      ORDER BY m.created_at DESC`,
    v.args,
  );
}

/**
 * Fetch one memory *as* an actor. Returns null when the row does not exist OR
 * when the actor is not entitled to it — deliberately indistinguishable, so an
 * ID-guessing probe cannot confirm that a Finance rule exists.
 */
export async function getMemoryAs(actor: Actor, memoryId: string): Promise<Memory | null> {
  const v = visibilityClause(actor);
  return one<Memory>(
    `SELECT m.* FROM memories m WHERE m.id = ? AND ${v.sql}`,
    [memoryId, ...v.args],
  );
}

/** Throws 403/404 instead of returning null. Used by edit + delete. */
export async function requireMemory(actor: Actor, memoryId: string): Promise<Memory> {
  const m = await getMemoryAs(actor, memoryId);
  if (!m) throw new HttpError(404, "Memory not found or not accessible to this user.");
  return m;
}

/** Write-side check: you cannot author into a scope you do not belong to. */
export function assertCanWrite(
  actor: Actor,
  scope: Scope,
  teamId: string | null,
): void {
  if (scope === "team") {
    if (!teamId) throw new HttpError(400, "Team memory requires a team.");
    if (!actor.teamIds.includes(teamId)) {
      throw new HttpError(403, `${actor.user.name} is not a member of that team.`);
    }
  }
  if (scope === "personal" && !actor.user.id) {
    throw new HttpError(400, "Personal memory requires an owner.");
  }
}

/**
 * Only the author (or, for org rules, any org member — they are collective)
 * may correct or delete. Team rules are editable by any member of that team.
 */
export function assertCanMutate(actor: Actor, memory: Memory): void {
  if (memory.scope === "personal" && memory.owner_user_id !== actor.user.id) {
    throw new HttpError(403, "Personal memories can only be changed by their owner.");
  }
  if (memory.scope === "team" && !actor.teamIds.includes(memory.team_id ?? "")) {
    throw new HttpError(403, "Team memories can only be changed by members of that team.");
  }
}

// ---------------------------------------------------------------------------
// Documents — reference material, scoped by exactly the same predicate.
// ---------------------------------------------------------------------------

/**
 * Documents are not rules: they are the material an answer cites. They are
 * scoped anyway, because "which pricing sheet exists" is as much a permission
 * question as "which pricing rule applies". Reusing `scopePredicate` means the
 * boundary is not re-implemented for a second kind of data.
 */
export async function listVisibleDocuments(actor: Actor): Promise<Doc[]> {
  const s = scopePredicate(actor, "d");
  return all<Doc>(
    `SELECT d.* FROM documents d WHERE ${s.sql} ORDER BY
       CASE d.scope WHEN 'org' THEN 0 WHEN 'team' THEN 1 ELSE 2 END, d.title`,
    s.args,
  );
}

export async function getDocumentAs(actor: Actor, docId: string): Promise<Doc | null> {
  const s = scopePredicate(actor, "d");
  return one<Doc>(`SELECT d.* FROM documents d WHERE d.id = ? AND ${s.sql}`, [
    docId,
    ...s.args,
  ]);
}
