/**
 * Drops every table so the next request re-seeds a pristine demo.
 * Reads DATABASE_URL / DATABASE_AUTH_TOKEN from the environment; with neither
 * set it targets the local file database.
 *
 *   set -a; . ./.env; set +a; node scripts/reset.mjs
 */
import { createClient } from "@libsql/client";

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

console.log(`resetting ${url.replace(/\/\/.*@/, "//")}`);
for (const t of tables) {
  await client.execute(`DROP TABLE IF EXISTS ${t}`);
  console.log(`  dropped ${t}`);
}
console.log("done — the next request rebuilds the schema and reseeds.");
