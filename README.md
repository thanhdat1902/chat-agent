# Memory for Agents Inside Organizations

Four users (Ryan, Sean — Finance; Daniel, Mitchell — Operations) share one org and one agent. Rules are extracted from ordinary conversation, stored at personal, team, or org scope, and applied automatically in later turns, later sessions, and other people's sessions when the scope allows it.

**Live:** https://chat-agent-sand.vercel.app — seeded so both required demos are one click from the empty sessions.

**Run it:** `npm install && npm run dev`. Set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` — whichever is present wins, OpenAI first); with neither, a deterministic extractor and a reporting agent keep the permission behaviour demonstrable. SQLite lives at `data/memory.db` and seeds itself on first request — set `DATABASE_URL`/`DATABASE_AUTH_TOKEN` to point at Turso for durable hosted state. `node scripts/demo.mjs <base-url>` replays every demo against a running instance; `scripts/smoke.sh` asserts the permission boundary.

### Memory schema

A memory is one durable instruction. `scope` ∈ `personal | team | org`, with exactly one of `owner_user_id` / `team_id` / `org_id` populated — a `CHECK` constraint enforces that invariant in the database, not just in application code, so a mis-scoped row cannot be written at all. Beyond that: `key` (a dotted category such as `pricing.source` — two memories sharing a key are competing instructions), `content`, `status`, `binding`, `confidence`, `created_by`, `source_session_id` / `source_message_id` / `source_quote`, `rationale`, `supersedes_id`. `memory_events` is an append-only audit trail (proposed, ratified, corrected, superseded, deleted); `message_memories` records which memories were injected into the prompt that produced a given reply, which is what the "N memories shaped this reply" affordance reads.

`status` carries the interesting behaviour. `active` means retrievable. **`pending` means visible only to its author and injected into nobody's prompt** — that single rule covers both "org rules require confirmation before they bind everyone" and "the agent guessed the scope."

### How scope gets assigned

Every user turn goes through an extractor (Claude with a JSON schema; a regex fallback when no key is set) that decides whether the message contains a durable rule at all — most don't — and, if so, who it binds. Scope comes from the **language of the request, not the seniority of the speaker**: explicit universality ("that goes for everyone", "company-wide") → org; a reference to the speaker's own team or its domain ("our team", "for renewals") → team; first-person framing about how the agent should treat this user ("give me bullets") → personal. Someone can only write a team rule for a team they belong to; naming another team downgrades to personal with the reason recorded.

**Ambiguity is not resolved by guessing wide.** The extractor returns a confidence, and anything below 0.7 — plus *every* org-scoped rule regardless of confidence, since an org rule binds four people — is written `pending` and surfaced inline as a one-click chip (Just me / Just Finance / Everyone / Everyone · binding / Discard). Guessing wrong therefore costs a click, never a leak.

### Where permissions are enforced

**In SQL, in one place.** `src/lib/permissions.ts` has a single function, `visibilityClause(actor)`, that turns "who is asking" into a `WHERE` predicate:

```sql
(scope='org' OR (scope='team' AND team_id IN (:actorTeams)) OR (scope='personal' AND owner_user_id=:actor))
AND (status <> 'pending' OR created_by = :actor)
```

Every read path — agent retrieval, the memory inspector, single-memory fetch, correct, delete — is built on it; there is no code path that reads the `memories` table without it. Writes are checked separately by `assertCanWrite` / `assertCanMutate`. **Permissions are not enforced in the prompt**: there is no "don't reveal other teams' rules" instruction, because a rule the user isn't entitled to was never fetched and so was never in the context to reveal. Fetching a memory by id as the wrong user returns 404 rather than 403 — deliberately indistinguishable from "no such row", so id-guessing can't confirm that a Finance rule exists. The **Leak test** tab in the app runs that probe live against the real endpoint and prints the predicate that produced the answer.

### What is retrieved, and what reaches the model

Per turn: fetch the actor's visible + active memories (SQL, above) → score each on precedence weight, confidence, lexical overlap with the current message and last few turns, and recency → resolve conflicts by `key` → take the top 12. Only the winners go into the system prompt, each tagged with scope and provenance (`Ryan set this, Mar 4`). Losers and anything cut by the budget are reported to the UI but never sent, so the model is never handed two contradictory instructions and asked to arbitrate. Retrieval runs *after* extraction, so a rule stated this turn applies to the same turn.

### Conflict resolution

**Binding org policy (4) > personal (3) > team (2) > org default (1)**, shown as a ladder in the Precedence tab alongside the live conflicts for the current user. Specificity wins because the person closest to the situation has the most context. The carve-out exists because some org rules aren't defaults at all — they're commitments the company has made ("no dates without engineering sign-off"), and without it any user could opt out of compliance by stating a preference. Ties break newest-first.

### What I'd fix with another week

Retrieval is lexical; a real store needs embeddings plus the same SQL filter as a pre-filter (never a post-filter). Session-level scope is missing — "for this thread only" is a real fourth scope. Extraction runs synchronously on every turn and should be a queued job with batching. There's no negative memory ("stop doing X" currently supersedes rather than recording a prohibition), no decay for stale rules beyond a recency weight, and no org-admin view for auditing across users. Deliberately cut: auth (per the brief), streaming responses, and multi-org tenancy — the `org_id` column is there but the boundary isn't exercised.
