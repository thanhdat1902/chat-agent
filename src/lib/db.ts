import { createClient, type Client, type InValue } from "@libsql/client";

/**
 * SQLite via libsql. Locally this is a plain file (`file:./data/memory.db`);
 * in production point DATABASE_URL/DATABASE_AUTH_TOKEN at Turso and nothing
 * else changes.
 */
let _client: Client | null = null;
let _ready: Promise<void> | null = null;

/**
 * Resolution order:
 *   1. DATABASE_URL — a Turso `libsql://` URL in production. Durable, shared
 *      across serverless instances. This is what a real deployment uses.
 *   2. On Vercel with no DATABASE_URL: `/tmp`, the only writable path in the
 *      runtime. Seeded per instance, so the demo data is always present but
 *      anything typed during a session is not shared across instances.
 *   3. Locally: a plain file under ./data.
 */
function defaultUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.VERCEL) return "file:/tmp/memory.db";
  return "file:./data/memory.db";
}

function rawClient(): Client {
  if (!_client) {
    const url = defaultUrl();
    _client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return _client;
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     role TEXT NOT NULL,
     color TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS teams (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS team_members (
     team_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     PRIMARY KEY (team_id, user_id)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     title TEXT NOT NULL,
     seq INTEGER NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS memories (
     id TEXT PRIMARY KEY,
     scope TEXT NOT NULL CHECK (scope IN ('personal','team','org')),
     owner_user_id TEXT,
     team_id TEXT,
     org_id TEXT,
     key TEXT NOT NULL,
     content TEXT NOT NULL,
     status TEXT NOT NULL,
     binding INTEGER NOT NULL DEFAULT 0,
     confidence REAL NOT NULL DEFAULT 0.5,
     rationale TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL,
     source_session_id TEXT,
     source_message_id TEXT,
     source_quote TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     supersedes_id TEXT,
     proposed_scope TEXT,
     -- The scope invariant is enforced by the database, not just by app code.
     CHECK (
       (scope = 'personal' AND owner_user_id IS NOT NULL AND team_id IS NULL)
       OR (scope = 'team' AND team_id IS NOT NULL AND owner_user_id IS NULL)
       OR (scope = 'org'  AND team_id IS NULL AND owner_user_id IS NULL AND org_id IS NOT NULL)
     )
   )`,
  `CREATE TABLE IF NOT EXISTS memory_events (
     id TEXT PRIMARY KEY,
     memory_id TEXT NOT NULL,
     actor_user_id TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS message_memories (
     message_id TEXT NOT NULL,
     memory_id TEXT NOT NULL,
     relation TEXT NOT NULL,
     PRIMARY KEY (message_id, memory_id, relation)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, status)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_team ON memories(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner_user_id)`,
];

async function init(): Promise<void> {
  const c = rawClient();
  for (const stmt of SCHEMA) await c.execute(stmt);
  // NOTE: the seed writes through the raw client, not `db()` — `_ready` is the
  // promise we are currently inside, so going back through `db()` would deadlock.
  const { seedIfEmpty } = await import("./seed");
  await seedIfEmpty(c);
}

/** Every query goes through here, so the schema + seed exist before first use. */
export async function db(): Promise<Client> {
  if (!_ready) _ready = init();
  await _ready;
  return rawClient();
}

function isMissingTable(err: unknown): boolean {
  return /no such table/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * "Schema is ready" is memoized per instance, which is right for the common
 * case and wrong the moment the database is reset out from under a warm
 * instance — the documented way to reset a demo. Without this the instance
 * stays broken until it recycles. On a missing-table error we re-run init
 * once and retry, so the app self-heals instead of serving 500s.
 */
async function withSchemaRetry<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  try {
    return await fn(await db());
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    _ready = null;
    return fn(await db());
  }
}

export async function all<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  return withSchemaRetry(async (c) => {
    const res = await c.execute({ sql, args });
    return res.rows as unknown as T[];
  });
}

export async function one<T>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<void> {
  await withSchemaRetry(async (c) => {
    await c.execute({ sql, args });
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

let counter = 0;
export function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
