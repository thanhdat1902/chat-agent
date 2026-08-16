# Deploying the live URL

The app runs on SQLite through `@libsql/client`. Locally that is a file; hosted, point the
same client at Turso and nothing in the code changes. Schema creation and seeding are
idempotent (`CREATE TABLE IF NOT EXISTS` + a row-count check), so a cold serverless start
is safe.

## 1. Create the hosted database

```bash
brew install tursodatabase/tap/turso   # or: curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create org-agent-memory
turso db show org-agent-memory --url          # -> libsql://org-agent-memory-<org>.turso.io
turso db tokens create org-agent-memory       # -> the auth token
```

## 2. Deploy

```bash
npm i -g vercel
vercel                       # link the project
vercel env add DATABASE_URL          # paste the libsql:// URL
vercel env add DATABASE_AUTH_TOKEN   # paste the token
vercel env add ANTHROPIC_API_KEY     # your key
vercel --prod
```

The first request to the deployed URL creates the schema and seeds the four users, their
sessions, and the memories that drive both required demos. To reset a live demo, run
`turso db shell org-agent-memory "DROP TABLE users"` and hit the URL again.

## Notes

- `next.config.mjs` is deliberately `.mjs`, not `.ts` — Next 15.5.4 hangs indefinitely at
  startup while compiling a TypeScript config on some Node 24 setups, with no error output.
- Without `ANTHROPIC_API_KEY` the app still runs: a deterministic extractor handles rule
  capture and the agent reports which memories it would have answered under. The permission
  boundary, retrieval, and conflict resolution are unaffected, since none of them involve
  the model.
- `scripts/smoke.sh` exercises the permission boundary end to end against any base URL:
  `BASE=https://your-app.vercel.app ./scripts/smoke.sh`.
