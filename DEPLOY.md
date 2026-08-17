# Deploying

Live: **https://chat-agent-sand.vercel.app**

The app talks to SQLite through `@libsql/client`. Locally that is a file; hosted, the same
client points at Turso and no code changes. Schema creation and seeding are idempotent
(`CREATE TABLE IF NOT EXISTS` plus a row-count check), so a cold serverless start is safe.

## Environment

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Provider for extraction and replies. Takes precedence when both keys are set. |
| `OPENAI_MODEL` | Defaults to `gpt-5.5`. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Alternative provider; `claude-opus-5` by default. |
| `DATABASE_URL` | `libsql://…` for Turso. Unset on Vercel falls back to `/tmp`, the only writable path in the runtime. |
| `DATABASE_AUTH_TOKEN` | Turso token. |

With no provider key the app still runs: a deterministic extractor handles rule capture and
the agent reports which memories it would have answered under. The permission boundary,
retrieval, and conflict resolution never call a model, so they behave identically.

## Storage

The live deployment runs on **Turso** (`libsql://studyfetch-demo-…`), so state is durable and
shared across serverless instances: a chat sent to one instance is readable from every other,
and newly extracted memories survive a refresh.

`DATABASE_URL` is what makes that true. Without it the deployment falls back to `/tmp` and
seeds a fresh database per instance — every demo still works, because the seed is identical
everywhere, but a chat sent to one instance is invisible to another.

To point at a different database:

```bash
turso db create org-agent-memory
turso db show org-agent-memory --url        # -> libsql://…
turso db tokens create org-agent-memory     # -> token
vercel env add DATABASE_URL production
vercel env add DATABASE_AUTH_TOKEN production
vercel --prod
```

### Resetting the demo

```bash
set -a; . ./.env; set +a
node scripts/reset.mjs
```

Drops every table; the next request rebuilds the schema and reseeds. Safe to run against a
live deployment — a warm instance that has already memoized "schema ready" detects the
missing tables, re-runs initialisation once, and serves the request rather than failing.

## Deploy

```bash
vercel link --project chat-agent
vercel env add OPENAI_API_KEY production
vercel --prod
```

The first request creates the schema and seeds the four users, their sessions, and the
memories that drive both required demos. To reset a Turso-backed demo:
`turso db shell org-agent-memory "DROP TABLE users"`, then load the URL again.

## Verifying a deployment

```bash
BASE=https://chat-agent-sand.vercel.app ./scripts/smoke.sh     # 15 permission assertions
MUTATE=1 BASE=http://localhost:3737 ./scripts/smoke.sh         # adds correct/ratify/delete
node scripts/demo.mjs https://chat-agent-sand.vercel.app       # replays every demo
```

## Notes

- `next.config.mjs` is deliberately `.mjs`. On some Node 24 setups Next hangs at startup
  compiling a TypeScript config, with no error output.
- The generated alias `chat-agent-<team>.vercel.app` sits behind Vercel Deployment
  Protection and 302s to SSO. `chat-agent-sand.vercel.app` is the public production alias.
