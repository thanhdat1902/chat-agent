import { all } from "./db";
import { listVisibleMemories } from "./permissions";
import { PRECEDENCE_LADDER, precedence } from "./memory";
import { activeProvider, modelLabel } from "./llm";
import type { Account, Actor, ChatSession, Memory, MemoryEvent, Message, User } from "./types";

export interface UserWithTeams extends User {
  teamIds: string[];
  teamNames: string[];
}

export interface MemoryView extends Memory {
  authorName: string;
  teamName: string | null;
  precedence: number;
  events: MemoryEvent[];
  overriddenBy: { id: string; content: string; scope: string } | null;
  supersededBy: { id: string; content: string } | null;
}

export interface AppState {
  actor: UserWithTeams;
  users: UserWithTeams[];
  sessionsByUser: Record<string, ChatSession[]>;
  activeSessionId: string | null;
  messages: Message[];
  memories: MemoryView[];
  ladder: typeof PRECEDENCE_LADDER;
  modelConfigured: boolean;
  modelLabel: string;
  /**
   * Where the "Run the guided demo" button should jump: an empty chat
   * belonging to someone who already has memories to demonstrate. Computed,
   * never hardcoded, so it survives a reseed, a blank slate, or a user
   * deleting the session it used to point at. Null when there is nothing to
   * demonstrate yet.
   */
  demoEntry: { userId: string; sessionId: string; userName: string } | null;
  /** Shared reference data every user sees — see the Account type. */
  accounts: Account[];
}

/**
 * Every round trip here crosses a region boundary, so the shape of this file
 * is latency-driven: independent queries run concurrently, and nothing runs
 * once per row. An earlier version fetched each memory's audit trail in its
 * own query, which put a full round trip per memory on the critical path of
 * every session switch.
 */
async function usersWithTeams(): Promise<UserWithTeams[]> {
  const [users, rows] = await Promise.all([
    all<User>(`SELECT * FROM users ORDER BY rowid`),
    all<{ user_id: string; id: string; name: string }>(
      `SELECT m.user_id, t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id`,
    ),
  ]);
  return users.map((u) => {
    const mine = rows.filter((r) => r.user_id === u.id);
    return { ...u, teamIds: mine.map((r) => r.id), teamNames: mine.map((r) => r.name) };
  });
}

function toActor(u: UserWithTeams): Actor {
  return { user: u, teamIds: u.teamIds, teamNames: u.teamNames };
}

export async function buildMemoryViews(
  actor: Actor,
  users: UserWithTeams[],
): Promise<MemoryView[]> {
  const memories = await listVisibleMemories(actor);
  if (memories.length === 0) return [];

  // One query for every audit trail, rather than one per memory.
  const placeholders = memories.map(() => "?").join(", ");
  const [events, teams] = await Promise.all([
    all<MemoryEvent>(
      `SELECT * FROM memory_events WHERE memory_id IN (${placeholders}) ORDER BY created_at ASC`,
      memories.map((m) => m.id),
    ),
    all<{ id: string; name: string }>(`SELECT id, name FROM teams`),
  ]);

  const eventsByMemory = new Map<string, MemoryEvent[]>();
  for (const e of events) {
    const list = eventsByMemory.get(e.memory_id) ?? [];
    list.push(e);
    eventsByMemory.set(e.memory_id, list);
  }

  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const teamOf = new Map(teams.map((t) => [t.id, t.name]));

  // Conflict resolution mirrored here so the inspector can show which memory
  // is currently losing — computed over the same visible set the agent uses.
  const winnerByKey = new Map<string, Memory>();
  for (const m of memories) {
    if (m.status !== "active") continue;
    const cur = winnerByKey.get(m.key);
    if (!cur || precedence(m) > precedence(cur)) winnerByKey.set(m.key, m);
  }

  const supersededBy = new Map<string, Memory>();
  for (const m of memories) {
    if (m.supersedes_id) supersededBy.set(m.supersedes_id, m);
  }

  return memories.map((m) => {
    const winner = winnerByKey.get(m.key);
    const sup = supersededBy.get(m.id);
    return {
      ...m,
      authorName: nameOf.get(m.created_by) ?? "Unknown",
      teamName: m.team_id ? (teamOf.get(m.team_id) ?? null) : null,
      precedence: precedence(m),
      events: eventsByMemory.get(m.id) ?? [],
      overriddenBy:
        m.status === "active" && winner && winner.id !== m.id
          ? { id: winner.id, content: winner.content, scope: winner.scope }
          : null,
      supersededBy: sup ? { id: sup.id, content: sup.content } : null,
    };
  });
}

/** Kept for callers that only have a user id. */
export async function loadMemoryViews(userId: string): Promise<MemoryView[]> {
  const users = await usersWithTeams();
  const actor = users.find((u) => u.id === userId);
  if (!actor) return [];
  return buildMemoryViews(toActor(actor), users);
}

export async function loadState(
  userId: string,
  sessionId: string | null,
): Promise<AppState> {
  const [users, sessions] = await Promise.all([
    usersWithTeams(),
    all<ChatSession>(`SELECT * FROM sessions ORDER BY user_id, seq`),
  ]);

  const actor = users.find((u) => u.id === userId) ?? users[0];
  const sessionsByUser: Record<string, ChatSession[]> = {};
  for (const u of users) sessionsByUser[u.id] = [];
  for (const s of sessions) (sessionsByUser[s.user_id] ??= []).push(s);

  const active =
    sessionId && sessions.some((s) => s.id === sessionId)
      ? sessionId
      : (sessionsByUser[actor.id]?.[0]?.id ?? null);

  const [messages, memories, accounts] = await Promise.all([
    active ? loadMessages(active) : Promise.resolve([]),
    buildMemoryViews(toActor(actor), users),
    all<Account>(
      `SELECT name, seats, prior_term_usd, q3_sheet_usd, rate_card_usd, renews_on, notes
         FROM accounts ORDER BY name`,
    ),
  ]);

  return {
    actor,
    users,
    sessionsByUser,
    activeSessionId: active,
    messages,
    memories,
    ladder: PRECEDENCE_LADDER,
    modelConfigured: activeProvider() !== "none",
    modelLabel: modelLabel(),
    demoEntry: await findDemoEntry(users, sessionsByUser),
    accounts,
  };
}

/**
 * An empty chat belonging to a user who would actually see something — i.e.
 * at least one active memory authored by somebody else. On a blank database
 * that is nobody, and the button hides itself.
 */
async function findDemoEntry(
  users: UserWithTeams[],
  sessionsByUser: Record<string, ChatSession[]>,
): Promise<AppState["demoEntry"]> {
  const counts = await all<{ session_id: string; n: number }>(
    `SELECT session_id, COUNT(*) AS n FROM messages GROUP BY session_id`,
  );
  const messageCount = new Map(counts.map((c) => [c.session_id, Number(c.n)]));

  for (const u of users) {
    const empty = (sessionsByUser[u.id] ?? []).find((s) => !messageCount.get(s.id));
    if (!empty) continue;
    const visible = await listVisibleMemories(toActor(u));
    const inherited = visible.filter((m) => m.status === "active" && m.created_by !== u.id);
    if (inherited.length > 0) {
      return { userId: u.id, sessionId: empty.id, userName: u.name };
    }
  }
  return null;
}

export async function loadMessages(sessionId: string): Promise<Message[]> {
  const [rows, links] = await Promise.all([
    all<Omit<Message, "used_memory_ids" | "created_memory_ids">>(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
      [sessionId],
    ),
    all<{ message_id: string; memory_id: string; relation: string }>(
      `SELECT mm.* FROM message_memories mm
         JOIN messages m ON m.id = mm.message_id
        WHERE m.session_id = ?`,
      [sessionId],
    ),
  ]);

  const used = new Map<string, string[]>();
  const created = new Map<string, string[]>();
  for (const l of links) {
    const target = l.relation === "used" ? used : created;
    const list = target.get(l.message_id) ?? [];
    list.push(l.memory_id);
    target.set(l.message_id, list);
  }

  return rows.map((r) => ({
    ...r,
    used_memory_ids: used.get(r.id) ?? [],
    created_memory_ids: created.get(r.id) ?? [],
  }));
}

/**
 * The landing target: the first user, and whichever of their chats has the
 * most messages — the conversation with the most context to read. On an empty
 * database this is simply their only chat.
 */
export async function pickLandingSession(): Promise<{
  userId: string;
  sessionId: string | null;
}> {
  const [users, sessions, counts] = await Promise.all([
    all<User>(`SELECT id FROM users ORDER BY rowid LIMIT 1`),
    all<ChatSession>(`SELECT * FROM sessions ORDER BY seq`),
    all<{ session_id: string; n: number }>(
      `SELECT session_id, COUNT(*) AS n FROM messages GROUP BY session_id`,
    ),
  ]);
  const userId = users[0]?.id ?? "u_ryan";
  const mine = sessions.filter((s) => s.user_id === userId);
  if (mine.length === 0) return { userId, sessionId: null };
  const n = new Map(counts.map((c) => [c.session_id, Number(c.n)]));
  const richest = [...mine].sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0))[0];
  return { userId, sessionId: richest.id };
}
