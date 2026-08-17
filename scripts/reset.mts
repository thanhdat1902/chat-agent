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
import { seedBlank } from "../src/lib/seed";

const blank = process.argv.includes("--blank");
const url = process.env.DATABASE_URL ?? "file:./data/memory.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const tables = [
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
for (const t of tables) await client.execute(`DROP TABLE IF EXISTS ${t}`);
console.log(`  dropped ${tables.length} tables`);

if (blank) {
  // Build the schema and the minimal data here, so the app's own seed sees
  // users already present and does not layer the demo data on top.
  for (const stmt of SCHEMA) await client.execute(stmt);
  await seedBlank(client);
  const n = await client.execute("SELECT COUNT(*) AS n FROM users");
  const s = await client.execute("SELECT COUNT(*) AS n FROM sessions");
  console.log(`  seeded ${n.rows[0].n} users, ${s.rows[0].n} empty chats, 0 memories`);
  console.log("\nBlank slate ready. Every rule you see from here you created.");
  console.log("Restore the demo data with:  npm run reset");
} else {
  console.log("  the next request rebuilds the schema and reseeds the demo");
}
