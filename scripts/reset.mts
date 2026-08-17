/**
 * Reset the database. Reads DATABASE_URL / DATABASE_AUTH_TOKEN from the
 * environment; with neither set it targets the local file database.
 *
 *   set -a; . ./.env; set +a
 *   npm run reset          # full demo seed — both required demos work on load
 *   npm run reset:blank    # four users, one empty chat each, zero rules
 *
 * Safe to run against a live deployment: a warm instance that has already
 * memoized "schema ready" detects the missing tables, re-runs initialisation
 * once, and serves the request rather than failing.
 */
import { createClient } from "@libsql/client";
import { SCHEMA } from "../src/lib/db";
import { blankSeedStatements } from "../src/lib/seed";

const blank = process.argv.includes("--blank");
const url = process.env.DATABASE_URL ?? "file:./data/memory.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const tables = [
  "documents",
  "message_memories",
  "memory_events",
  "memories",
  "messages",
  "sessions",
  "team_members",
  "teams",
  "users",
];

console.log(`resetting ${url.replace(/\/\/.*@/, "//")}  (${blank ? "blank slate" : "full demo seed"})`);

if (blank) {
  /**
   * Drop, rebuild and seed in ONE transaction.
   *
   * Doing these as separate statements against a live deployment loses a race:
   * any request landing in the gap hits a missing table, the app's self-heal
   * re-runs initialisation, and `seedIfEmpty` lays down the *demo* data — after
   * which the blank inserts no-op on their ids and the reset silently produces
   * the opposite of what was asked for. A single batch leaves no gap.
   */
  await client.batch(
    [
      ...tables.map((t) => ({ sql: `DROP TABLE IF EXISTS ${t}`, args: [] })),
      ...SCHEMA.map((sql) => ({ sql, args: [] })),
      ...blankSeedStatements(),
    ],
    "write",
  );
  const [u, s, m] = await Promise.all([
    client.execute("SELECT COUNT(*) AS n FROM users"),
    client.execute("SELECT COUNT(*) AS n FROM sessions"),
    client.execute("SELECT COUNT(*) AS n FROM memories"),
  ]);
  console.log(
    `  seeded ${u.rows[0].n} users, ${s.rows[0].n} empty chats, ${m.rows[0].n} memories`,
  );
  console.log("\nBlank slate ready. Every rule you see from here you created.");
  console.log("Restore the demo data with:  npm run reset");
} else {
  for (const t of tables) await client.execute(`DROP TABLE IF EXISTS ${t}`);
  console.log(`  dropped ${tables.length} tables`);
  console.log("  the next request rebuilds the schema and reseeds the demo");
}
