import { all } from "./db";
import { listVisibleMemories, loadActor } from "./permissions";
import { PRECEDENCE_LADDER, precedence, memoryEvents } from "./memory";
import { activeProvider, modelLabel } from "./llm";
import type { ChatSession, Memory, MemoryEvent, Message, User } from "./types";

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
}

async function usersWithTeams(): Promise<UserWithTeams[]> {
  const users = await all<User>(`SELECT * FROM users ORDER BY rowid`);
  const rows = await all<{ user_id: string; id: string; name: string }>(
    `SELECT m.user_id, t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id`,
  );
  return users.map((u) => {
    const mine = rows.filter((r) => r.user_id === u.id);
    return { ...u, teamIds: mine.map((r) => r.id), teamNames: mine.map((r) => r.name) };
  });
}

export async function loadMemoryViews(userId: string): Promise<MemoryView[]> {
  const actor = await loadActor(userId);
  const memories = await listVisibleMemories(actor);
  const users = await all<User>(`SELECT id, name FROM users`);
  const teams = await all<{ id: string; name: string }>(`SELECT id, name FROM teams`);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const teamOf = new Map(teams.map((t) => [t.id, t.name]));

  // Conflict resolution mirrored here so the inspector can show which memory
  // is currently losing — computed over the same visible set the agent uses.
  const active = memories.filter((m) => m.status === "active");
  const winnerByKey = new Map<string, Memory>();
  for (const m of active) {
    const cur = winnerByKey.get(m.key);
    if (!cur || precedence(m) > precedence(cur)) winnerByKey.set(m.key, m);
  }

  const supersededBy = new Map<string, Memory>();
  for (const m of memories) {
    if (m.supersedes_id) supersededBy.set(m.supersedes_id, m);
  }

  const views: MemoryView[] = [];
  for (const m of memories) {
    const winner = winnerByKey.get(m.key);
    const sup = supersededBy.get(m.id);
    views.push({
      ...m,
      authorName: nameOf.get(m.created_by) ?? "Unknown",
      teamName: m.team_id ? (teamOf.get(m.team_id) ?? null) : null,
      precedence: precedence(m),
      events: await memoryEvents(m.id),
      overriddenBy:
        m.status === "active" && winner && winner.id !== m.id
          ? { id: winner.id, content: winner.content, scope: winner.scope }
          : null,
      supersededBy: sup ? { id: sup.id, content: sup.content } : null,
    });
  }
  return views;
}

export async function loadState(
  userId: string,
  sessionId: string | null,
): Promise<AppState> {
  const users = await usersWithTeams();
  const actor = users.find((u) => u.id === userId) ?? users[0];

  const sessions = await all<ChatSession>(
    `SELECT * FROM sessions ORDER BY user_id, seq`,
  );
  const sessionsByUser: Record<string, ChatSession[]> = {};
  for (const u of users) sessionsByUser[u.id] = [];
  for (const s of sessions) (sessionsByUser[s.user_id] ??= []).push(s);

  const active =
    sessionId && sessions.some((s) => s.id === sessionId)
      ? sessionId
      : (sessionsByUser[actor.id]?.[0]?.id ?? null);

  const messages = active ? await loadMessages(active) : [];

  return {
    actor,
    users,
    sessionsByUser,
    activeSessionId: active,
    messages,
    memories: await loadMemoryViews(actor.id),
    ladder: PRECEDENCE_LADDER,
    modelConfigured: activeProvider() !== "none",
    modelLabel: modelLabel(),
  };
}

export async function loadMessages(sessionId: string): Promise<Message[]> {
  const rows = await all<Omit<Message, "used_memory_ids" | "created_memory_ids">>(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
    [sessionId],
  );
  const links = await all<{ message_id: string; memory_id: string; relation: string }>(
    `SELECT mm.* FROM message_memories mm
       JOIN messages m ON m.id = mm.message_id
      WHERE m.session_id = ?`,
    [sessionId],
  );
  return rows.map((r) => ({
    ...r,
    used_memory_ids: links.filter((l) => l.message_id === r.id && l.relation === "used").map((l) => l.memory_id),
    created_memory_ids: links
      .filter((l) => l.message_id === r.id && l.relation === "created")
      .map((l) => l.memory_id),
  }));
}
