# Testing guide

A step-by-step walkthrough starting from an **empty database**. Every rule you see by the end,
you created — nothing is pre-seeded, so there is no ambiguity about where anything came from.

**Live:** https://chat-agent-sand.vercel.app

Run the acts **in order**: each one creates the rules the next one tests.

> **Test against the live URL, not `npm run dev`.** Your `.env` sets `DATABASE_URL`, and Next
> loads `.env` in development too — so a local server reads and writes the *same* Turso database
> as production. Running locally gains you nothing here and risks two servers mutating one
> database. For a genuinely isolated local run, comment out `DATABASE_URL` and
> `DATABASE_AUTH_TOKEN` first; the app falls back to `data/memory.db` on your disk.

> **This guide is for the blank slate, not for recording.** After `npm run reset` the demo data
> is already in place, so these acts would collide with it — Act 3.1 recreates a rule that
> already exists, and the memory counts stop matching. For the recording, see
> [Act 7](#act-7--restore-the-demo-data-for-recording).

---

## Act 0 — Start clean

```bash
cd app
set -a; . ./.env; set +a
npm run reset:blank
```

```
resetting libsql://…  (blank slate)
  dropped 8 tables
  seeded 4 users, 4 empty chats, 0 memories
```

Reload the app.

**Expected:** four users in the sidebar — Ryan and Sean on **Finance**, Mitchell and Daniel on
**Operations** — each with a single `Chat session #1 — New chat`, and **zero memories** in the
right rail for everyone.

> To restore the full demo data at any point: `npm run reset` (no flag). That version is what a
> reviewer should see, because both required demos work on first load without typing anything.

**Where to look while testing**

| Pane | What it shows |
|---|---|
| Sidebar | Everyone's chats. Opening one binds you to that user — the **Acting as** value follows |
| Header, right | `last turn: N injected / M visible` — how many memories reached the prompt |
| Under a reply | *"N memories shaped this reply"* — click for the exact list with provenance |
| Right rail → **What X knows** | Every memory this user is entitled to, grouped by scope |
| Right rail → **Precedence** | The ladder plus live conflicts for this user |
| Right rail → **Leak test** | Pick a memory *you* can see, ask whether someone else can |

**Reference documents.** Alongside memories, the agent can cite documents — and those are scoped
by the **same** SQL predicate. Right rail → **Shared data**:

| Document | Scope | Who sees it |
|---|---|---|
| Account book — customers, seats, prior term, **public rate card**, renewal dates | `org` | everyone |
| Product roadmap — target dates for in-flight work | `org` | everyone |
| **Q3 renewal pricing sheet** — the internal renewal figures | `team · Finance` | Ryan, Sean |
| Implementation runbook — rollout sequence, contacts | `team · Operations` | Daniel, Mitchell |

Every document states **facts only**. None says what *should* be done — no "engineering has not
signed off", no "never page a manager directly". Knowing the SSO target date and being allowed to
promise it are different things: the roadmap supplies the first, memory supplies the second. A
document that asserted the policy would answer the question the rule exists to answer, and the
whole demo would prove nothing.

The org-wide account book is the **control**: identical for all four users, so a difference in two
answers cannot be blamed on them looking at different customers. The Q3 sheet is the **variable**:
Operations does not merely lack the rule about which sheet to quote — the sheet itself never comes
back from their query. Documents are not rules, but "which pricing sheet exists" is as much a
permission question as "which pricing rule applies", so both run through `scopePredicate()`.

**One expectation to set:** the agent's wording changes run to run. What is stable — and what you
should actually check — is the **scope**, the **status**, which memories were **injected**, and
which were **overridden**. Those come from SQL and TypeScript, not from the model.

---

## Act 1 — Rule detection: what counts as a rule

Act as **Ryan**. Send each message in his chat.

### 1.1 Small talk

```
Thanks, that looks good. How was your weekend?
```

**Expected: nothing stored.** No chip under your message. Right rail still shows 0 memories.

> Every turn runs through `extractRules()`, whose first job is to decide whether the message
> contains a *durable instruction* at all. The prompt states that returning nothing is the
> correct and common answer.

### 1.2 A keyword that is not a rule

```
The customer always asks about SSO on these calls.
```

**Expected: nothing stored.**

> This separates reasoning from string matching. `always` is in the regex fallback's
> `RULE_SIGNALS` list, so a keyword matcher fires here. The model doesn't — it reads an
> observation about the customer, not an instruction to the agent. Keyword matching only runs
> when no API key is set.

### 1.3 A real personal rule

```
When I ask for a summary, lead with the number and put the caveats underneath.
```

**Expected: `PERSONAL` · `active`.** A chip appears under your message; the rule appears under
**Personal** in the right rail. Ryan now has **1 memory**.

> The extractor returns `scope: "personal"` with confidence ~0.9. `decideStatus()` sees a
> non-org scope above the 0.7 bar, so it is `active` immediately.

### 1.4 It applies with no reminder

```
Summarise where the Acme renewal stands.
```

**Expected:** the reply leads with a figure, caveats after. Click *"1 memory shaped this reply"* —
your rule from 1.3 is listed, attributed to Ryan.

> Retrieval runs *after* extraction, so a rule stated in one turn already applies to the next.

---

## Act 2 — Scope binding: personal vs team vs org

Still **Ryan** (Finance).

### 2.1 Team scope

```
Our team should always attach the signed order form to renewal threads.
```

**Expected: `TEAM · Finance` · `active`.** Ryan now has 2 memories: 1 personal, 1 team.

> `"Our team"` is an explicit team signal. The **team itself is not taken from the model** —
> `writeMemory()` sets `team_id` from the server-loaded actor. Writing into a team you are not on
> is not expressible through this path.

### 2.2 Org scope waits for confirmation

```
One more thing for everyone, company-wide: never give a customer a delivery date, not even as a target or estimate, unless engineering has signed off on that specific date.
```

> **Say what you mean — the wording is the rule.** An earlier version of this step said *"never
> promise a delivery date"*, and the agent obeyed it exactly: it kept the roadmap date and simply
> declined to call it committed (*"I don't want to position that as a committed ship date until
> Engineering signs off"*). That is correct behaviour for that sentence. Memory here is
> user-authored natural language, so precision in the rule is precision in the behaviour — the
> system delivers the right rule to the right person, it does not sharpen a vague one.

**Expected: `ORG` · `pending`**, with a confirmation panel inline under your message:

> **Confirm scope before this binds anyone**
> `Just me` · `Just Finance` · `Everyone` · `Everyone · binding policy` · `Discard`

**Leave it unconfirmed for now.**

> `decideStatus()` returns `pending` for *every* org-scoped rule regardless of confidence, because
> an org rule binds four people. A `pending` row is visible only to its author — enforced in the
> same SQL predicate as everything else (`status <> 'pending' OR created_by = :actor`).

### 2.3 Prove `pending` binds nobody

Switch to **Sean** (click his chat):

```
Can you tell Acme the SSO integration will be live on September 30?
```

**Expected: it shares the date, citing the roadmap.** Something like:

> Per the roadmap, SSO integration is **targeted for September 30** and is currently in **Build**.

It will likely soften *"will be live"* to *"targeted"* on its own — the model dislikes hard
commitments regardless. What matters is that it **passes the date along** and says nothing about
sign-off. The header should read `1 injected` — the Finance team rule from 2.1, and nothing else.
Ryan's pending org rule is not among them.

Sean does already have **1 memory**: the Finance team rule from 2.1. Ryan wrote it, Sean is on
Finance, so it reached him with no action from either of them — team inheritance, two acts before
Act 3 tests it deliberately. Click *"1 memory shaped this reply"* to confirm it is the team rule
and not the pending one.

> **Read the count, not the prose.** The model has its own instinct to hedge about dates, so the
> wording alone is a weak signal here — it may soften the date on its own. The mechanical proof is
> the memory count: **1** before you ratify, **2** after, with the second one tagged `ORG ·
> BINDING` and attributed to Ryan.

### 2.4 Ratify as a binding policy

Back to **Ryan**, click **`Everyone · binding policy`**.

**Expected:** the chip becomes `ORG · BINDING` · `active`.

> **Choose `Everyone · binding policy`, not plain `Everyone`.** Act 4.4 tests that a binding
> policy outranks a personal preference. Ratified as a plain org default it scores `1`, *below*
> personal's `3`, so 4.4 would show the personal rule winning — the opposite result, and it would
> look like a bug when it is the ladder working correctly.

Switch to **Sean** and ask the same question as 2.3.

**Expected: it refuses to commit** — *"we need **engineering sign-off** before committing that
date to Acme"* — and offers compliant wording. The reply reports **2 memories shaped this reply**, the new one
tagged `ORG · BINDING` and attributed to *"Ryan set this, \<today\>"*.

> **The precise tell is the phrase "engineering sign-off".** It appears only once the rule is
> active — that language exists nowhere in the documents, so it can only have come from memory.
> The injected count going 1 → 2 is the other half of the proof.

> **This is Demo 1 from the brief**, built by hand: Ryan set a rule in his own chat, Sean never
> saw it, and Sean's agent follows it with no reminder. `confirmMemory()` only flipped the status
> — the same predicate that hid it now returns it.

---

## Act 3 — Access from another role

**This is Demo 2.** It has two halves, and they are worth keeping apart:

- **3.1–3.3 — the document boundary.** Finance can read a pricing sheet Operations cannot, so
  they quote different numbers. No rule involved.
- **3.4–3.5 — the rule boundary.** A Finance rule then changes what Finance *does* with those
  numbers, and Operations is unaffected.

Both are enforced by the same SQL predicate. Showing them separately is what makes it clear which
mechanism is doing what.

### 3.1 Finance reads the internal sheet

As **Sean** (Finance):

```
How should I price the Northwind renewal?
```

**Expected: `$87,400`.** Something like:

> Price Northwind at **$87,400** for the Q3 renewal. That's **+$3,400 vs prior term** per the
> Finance Q3 renewal pricing sheet.

Note there is **no pricing rule yet** — nobody has told the agent which sheet to use. It quoted
the Q3 figure because the Q3 sheet is a Finance document and Sean can read it.

### 3.2 Operations reads a different one

As **Mitchell** (Operations), **the identical message**:

```
How should I price the Northwind renewal?
```

**Expected: `$91,200`.** Something like:

> Price Northwind at the public rate card: **$91,200 for 240 seats** — up **$7,200 vs prior
> term**, about an **8.6% uplift**.

**Two colleagues just quoted the same customer a $3,800 different price**, and neither is
misbehaving. Mitchell quoted the only pricing he can read.

### 3.3 See why

Right rail → **Shared data**, as each of them:

| | Documents |
|---|---|
| Sean | Account book · Product roadmap · **Q3 renewal pricing sheet** |
| Mitchell | Account book · Product roadmap · **Implementation runbook** |

The string `$87,400` appears nowhere Mitchell can read. Then → **Leak test**, pick the Q3 sheet as
Sean and run it as each user:

| Requested by | Expected |
|---|---|
| Ryan, Sean (Finance) | **200** |
| Daniel, Mitchell (Operations) | **404** |

> `getMemoryAs` and `getDocumentAs` both return **404, not 403**, for a row that exists but is out
> of scope — indistinguishable from "no such row", so guessing ids cannot confirm a Finance
> document exists.

### 3.4 Now a rule changes what Finance does with it

As **Ryan**:

```
For the Finance team: any renewal increase above 3% must be flagged for the account owner and cannot go to the customer until they approve it.
```

**Expected: `TEAM · Finance` · `active`.**

> Note what kind of rule this is. It does not tell the agent *which figure* to use — the document
> already settles that. It tells it what to **do** with the figure, and it is conditional on the
> data: 3% is a threshold the agent has to compute against.

### 3.5 Watch it fire, for Finance only

As **Sean**, ask the same pricing question again.

**Expected: the same $87,400, plus an approval step.** Something like:

> Prior term **$84,000** · Increase **+$3,400 / +4.0%** … because the increase is above 3%, this
> needs the account owner's approval before it goes to Acme.

The agent computed 4.0% against the threshold and added a step it did **not** take in 3.1.

Now as **Mitchell**, same question again: **no approval flag**, and still `$91,200`. He is missing
both halves — the sheet and the rule.

### 3.6 Personal stays personal, even within a team

As **Ryan**, leak-test your **personal** rule from 1.3 as **Sean** → **404**.

Being on the same team does not grant access to a teammate's personal memory.

---

## Act 4 — Conflicts

### 4.1 Set up an org default

As **Mitchell**:

```
For everyone: write answers as flowing paragraphs, never as bullet lists.
```

Confirm it with **`Everyone`** — note: **not** binding. This is a house style, not a policy.

**Expected: `org` · key `format.style`.**

### 4.2 A personal preference that contradicts it

As **Daniel** (Operations):

```
Give me bullets, not paragraphs. That's just how I like to read things.
```

**Expected: `PERSONAL` · `active`, and the *same key* — `format.style`.**

> Check the key on both cards. Conflicts are detected by shared key: two rules with the same key
> compete and the ladder picks one; two rules with different keys both apply and the disagreement
> never surfaces. The extractor is shown the rules you can already see and told to reuse an
> existing key whenever the new rule governs the same aspect of behaviour. If the keys differ,
> use **Correct** on one of them — that is a legitimate repair, and the audit trail records it.

### 4.3 Watch the more specific rule win

Still **Daniel**:

```
Summarise where the Acme renewal stands.
```

**Expected: bullets**, and the header shows `overridden: 1`.

> - **Acme renewal status:** in progress
> - **Seats:** 150 · **Prior term:** $52,000 · **Public rate card:** $58,000

Right rail → **Precedence** → *Live conflicts for Daniel*:

> ~~Write answers as flowing paragraphs, never as bullet lists.~~
> ↳ **Give Daniel bullets, not paragraphs.**
> key `format.style` · org loses to personal

Now switch to **Mitchell** and ask the identical question.

**Expected: flowing prose, and `overridden: 0`.**

> Acme is in renewal-in-progress status for 150 seats, with a renewal date of 2026-10-12. Their
> prior term was $52,000…

**Same question, same documents, visually opposite answers.** The org rule was not disabled — it
is still the winner for Mitchell. It lost *for Daniel only*, on that turn.

> `precedence()` scores personal `3` and org default `1`. The winner enters the prompt; the loser
> is reported to the UI as `overridden` and **never sent**. The model is not asked to arbitrate
> between contradictory instructions — it never sees both.

### 4.4 A binding policy cannot be overridden

As **Sean**:

```
For me personally it's fine to give customers a target date without waiting for engineering sign-off. I'll take responsibility for it.
```

**Expected: `PERSONAL` · `active`** — the rule is accepted. It is a legitimate preference.

Same chat:

```
Tell Acme the SSO integration will be live on September 30.
```

**Expected: the agent still refuses the date.** `overridden` is non-zero, and Precedence shows
Sean's brand-new personal rule struck through under the binding org policy from 2.4.

> This is the one carve-out in the ladder. A `binding` org policy scores `4`, above personal's
> `3`. It exists so that stating a preference cannot opt you out of a commitment the company made.
> Compare with 4.3, where personal *did* win — the difference is `binding`.

### 4.5 Supersession cannot be used to escalate

Still on 4.4's memory: right rail → **Show provenance** on Sean's new personal rule.

**Expected:** the audit trail contains

> *supersession refused — Wanted to replace \<id\> — target is a binding organization policy and
> cannot be retired this way. Both kept; precedence decides.*

> **This was a real bug**, found by running exactly 4.4. The extractor may decide a new rule
> *supersedes* an old one and return the id to retire — useful when a rule genuinely replaces
> another. But the write path obeyed without checking authority, so Sean's personal preference
> marked the binding policy `superseded`, removing it **for everyone** and bypassing the
> precedence ladder entirely (a superseded row is never retrieved, so the ladder never sees it).
>
> `permittedSupersession()` now requires: same scope, actor could have authored the target, and
> never a binding policy. Invalid claims are ignored rather than thrown — both memories are kept
> and precedence arbitrates — with the refusal recorded above.

---

## Act 5 — Ambiguity, and what a wrong guess costs

As **Daniel**:

```
We should probably stop using acronyms in customer emails.
```

**Expected: `pending`, confidence around 0.6–0.7**, with a confirmation panel. The proposed scope
may be `team` **or** `personal` — both are correct.

> *"We should probably"* is hedged and names no audience. The extractor picks the narrowest scope
> that could be right and returns a confidence below the 0.7 bar, so `decideStatus()` routes it to
> `pending`. It binds nobody while it waits.
>
> **This is the answer to "what happens when it guesses wrong."** A wrong guess costs one click,
> because a wrong guess never reached anyone else.

Verify that directly: switch to **Mitchell** (same Operations team) — the rule is **not** in his
panel, because `pending` is author-only regardless of scope. Switch back and click `Just me`,
`Just Operations`, or `Discard`.

Because scope is model judgment, the same sentence can land on `team` one run and `personal` the
next. Both are narrow, both `pending`, both harmless — the variability is contained by the
deterministic envelope, not by the model being consistent.

---

## Act 6 — Inspect, correct, delete

### 6.1 Provenance

Right rail → any memory → **Show provenance**.

**Expected:** the exact quoted span it came from, the extractor's stated reason for the scope, the
confidence, and the audit trail (`proposed`, `ratified`, `corrected`, `superseded`, `deleted`).

### 6.2 Correct the text

**Correct** → edit → **Save correction**.

**Expected:** the text updates and provenance gains a `corrected` entry recording the old value.

### 6.3 Correct the scope

Same editor, change the scope dropdown, save.

**Expected:** the memory moves between the Personal / Team / Organization groups. Watch a
teammate's panel gain or lose it accordingly.

### 6.4 Delete a memory

**Delete** → confirmation stating **This cannot be undone**, and warning when others rely on it:

> *This rule is in force for the Finance team. Deleting it removes it for them too.*

### 6.5 Delete a chat

Hover one of **your own** chats → trash icon appears → click.

**Expected:** a confirmation naming the chat, stating it cannot be undone, and noting:

> *Rules the agent learned from this conversation are kept — they may be in use by your team.*

Confirm. The chat disappears — **and the memories extracted from it are still in the right rail.**

> Deleting a chat removes the transcript, not the knowledge. A ratified team rule is something
> colleagues depend on; letting someone revoke it by tidying their own history would be a bad
> failure mode. Removing a rule stays a separate, explicit act.

The icon only appears on your own chats, and the server refuses cross-user deletes with **403**
regardless of what the client sends.

---

## Act 7 — Restore the demo data, for recording

```bash
npm run reset
```

**Expected:** the seeded organization is back — four users with several chats each, real
transcripts, and the memories that make both required demos work on first load.

**Do not re-run Acts 1–6 against this state.** They were written for an empty database and will
collide with the seeded rules. The seeded demo needs no typing at all — that is the point of it,
and it is what the brief asks for ("reviewers should not need to configure the demos themselves").

A five-minute walkthrough on the seeded data:

| Step | Action | What it shows |
|---|---|---|
| 1 | Open the app | Lands on Ryan's session #2 — the conversation where he sets the org rule, days ago |
| 2 | Sidebar → **Run the guided demo →** | Jumps to Sean's empty chat |
| 3 | Click the first demo card | **Demo 1** — Sean refuses the date, following a rule he never saw. Click *"N memories shaped this reply"* to show it attributed to Ryan |
| 4 | Click the second demo card | **Demo 2a** — Sean gets the Q3 pricing sheet |
| 5 | Sidebar → Mitchell's chat → same card | **Demo 2b** — same question, no Q3 sheet. His memory panel has no Finance rules |
| 6 | Right rail → **Leak test** | Probe the Finance rule as Mitchell → 404, with the SQL predicate printed |
| 7 | Sidebar → Daniel → **Precedence** tab | The ladder, and his personal rule beating the org default |
| 8 | Talk over [PIPELINE.md](PIPELINE.md) | The five diagrams: architecture, turn lifecycle, scope decision, permission boundary, retrieval |

Reset again between takes with `npm run reset`.

---

## Automated suites

Everything above is asserted in code too — these do not need the UI.

Run the smoke suite after each act — it discovers what exists and reports which permission
properties are now provable, skipping the rest. Skips turn into passes as you create rules.

```bash
npm run verify                                   # 49 assertions, no HTTP layer
BASE=https://chat-agent-sand.vercel.app npm run smoke    # adapts to whatever state you are in
MUTATE=1 BASE=http://localhost:3737 npm run smoke        # adds correct / ratify / delete
node scripts/demo.mjs https://chat-agent-sand.vercel.app # replays every demo, prints replies
```

`npm run verify` covers what is awkward to reach over HTTP. It runs against its own throwaway
database, so it is safe at any time and does not touch your blank slate:

```
visibility                  9 assertions — every scope, both directions, pending
retrieval and conflict      5 — including "no superseded memory is ever injected"
write guards                5 — cross-user correct/delete/ratify, team derivation
correct / ratify / delete   7 — full lifecycle, including cross-user visibility flips
documents                   9 — same predicate as memories, both directions
supersession escalation     5 — the Act 4.5 regression
delete a chat               9 — ownership, orphan cleanup, knowledge survival
```

---

## Quick reference

| Act | Message | As | Expected |
|---|---|---|---|
| 1.1 | "How was your weekend?" | Ryan | nothing stored |
| 1.2 | "The customer always asks about SSO." | Ryan | nothing stored — observation, not instruction |
| 1.3 | "When I ask for a summary, lead with the number…" | Ryan | `personal` · `active` |
| 2.1 | "Our team should always attach the signed order form…" | Ryan | `team · Finance` · `active` |
| 2.2 | "for everyone: never give a date, not even a target…" | Ryan | `org` · **`pending`** |
| 2.3 | "Tell Acme it'll be live September 30" | Sean | gives the date — pending binds nobody |
| 2.4 | same, after ratifying as binding | Sean | **refuses** the date |
| 3.1 | "How should I price the Northwind renewal?" | Sean | **$87,400** — from the Finance-only Q3 sheet, no rule needed |
| 3.2 | identical message | Mitchell | **$91,200** — the only sheet he can read |
| 3.3 | probe the Q3 sheet | Mitchell | **404** |
| 3.3 | probe the account book | Mitchell | **200** |
| 3.4 | "any renewal increase above 3% must be flagged…" | Ryan | `team · Finance` · `active` |
| 3.5 | same question after the rule | Sean | same $87,400, now **flagged for approval** at +4.0% |
| 3.5 | same question after the rule | Mitchell | still $91,200, **no approval flag** |
| 4.3 | "Summarise where the Acme renewal stands." | Daniel | **bullets** · `overridden: 1` |
| 4.3 | identical question | Mitchell | **flowing prose** · `overridden: 0` |
| 4.4 | "For me it's fine to give dates…" then ask for a date | Sean | stored, then **overridden** by binding |
| 5 | "We should probably stop using acronyms…" | Daniel | narrow scope · **`pending`** |
| 6.5 | delete Sean's chat | Mitchell | **403** |
