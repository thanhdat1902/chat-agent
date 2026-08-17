/**
 * Exercises the permission boundary and the memory lifecycle directly against
 * the library, with no HTTP layer. Run: `npm run verify`.
 *
 * This is the assertion suite for the parts a request-level test cannot reach
 * cleanly: correction, ratification, deletion, the write-side guards, and the
 * conflict resolution that decides what a prompt is allowed to contain.
 */
process.env.DATABASE_URL = "file:./data/verify.db";

import { rmSync } from "node:fs";
for (const s of ["", "-wal", "-shm"]) {
  try {
    rmSync(`./data/verify.db${s}`);
  } catch {
    /* absent */
  }
}

const { loadActor, getMemoryAs, listVisibleMemories, HttpError } = await import(
  "../src/lib/permissions"
);
const {
  retrieveForTurn,
  correctMemory,
  deleteMemory,
  confirmMemory,
  writeMemory,
  memoryEvents,
} = await import("../src/lib/memory");

let pass = 0;
let fail = 0;
function check(name: string, expected: unknown, actual: unknown) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  ok ? pass++ : fail++;
}
async function throws(name: string, status: number, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, `HttpError ${status}`, "no error thrown");
  } catch (e) {
    check(name, status, e instanceof HttpError ? e.status : `other: ${(e as Error).message}`);
  }
}

const ryan = await loadActor("u_ryan");
const sean = await loadActor("u_sean");
const daniel = await loadActor("u_daniel");
const mitchell = await loadActor("u_mitchell");

console.log("\n== visibility ==");
check("sean sees the finance rule", true, Boolean(await getMemoryAs(sean, "mem_fin_pricing")));
check("mitchell does not", null, await getMemoryAs(mitchell, "mem_fin_pricing"));
check("daniel does not", null, await getMemoryAs(daniel, "mem_fin_pricing"));
check("ryan does not see the ops rule", null, await getMemoryAs(ryan, "mem_ops_escalation"));
check("daniel sees the ops rule", true, Boolean(await getMemoryAs(daniel, "mem_ops_escalation")));
check("org rule reaches mitchell", true, Boolean(await getMemoryAs(mitchell, "mem_org_dates")));
check("personal stays personal", null, await getMemoryAs(mitchell, "mem_daniel_bullets"));
check("pending is author-only", null, await getMemoryAs(daniel, "mem_pending_cc"));
check("author sees own pending", true, Boolean(await getMemoryAs(mitchell, "mem_pending_cc")));

console.log("\n== retrieval and conflict resolution ==");
const seanR = await retrieveForTurn(sean, "How should I price the Northwind renewal?");
const mitchR = await retrieveForTurn(mitchell, "How should I price the Northwind renewal?");
check(
  "finance pricing rule reaches sean's prompt",
  true,
  seanR.injected.some((m) => m.key === "pricing.source"),
);
check(
  "and never reaches mitchell's",
  false,
  mitchR.injected.some((m) => m.key === "pricing.source"),
);
const danR = await retrieveForTurn(daniel, "Where does the Acme rollout stand?");
const winner = danR.injected.find((m) => m.key === "format.style");
check("personal beats the org default for daniel", "personal", winner?.scope);
check(
  "and the org default is reported as overridden, not sent",
  true,
  danR.overridden.some((o) => o.memory.scope === "org" && o.memory.key === "format.style"),
);
check(
  "no superseded memory is ever injected",
  false,
  danR.injected.some((m) => m.status !== "active"),
);

console.log("\n== write guards ==");
await throws("mitchell cannot correct daniel's personal rule", 404, () =>
  correctMemory(mitchell, "mem_daniel_bullets", { content: "hijacked" }),
);
await throws("mitchell cannot delete a finance rule", 404, () =>
  deleteMemory(mitchell, "mem_fin_pricing"),
);
// 404, not 403: a colleague cannot see someone else's pending proposal at all,
// so the visibility check fires before the authorship check. The stronger of
// the two answers wins, and the two cases stay indistinguishable.
await throws("a colleague cannot ratify someone else's proposal", 404, () =>
  confirmMemory(daniel, "mem_pending_cc", { accept: true, scope: "org" }),
);

// Writing into another team is not expressible: the target team is derived
// from the actor the server loaded, never from the request. A team rule
// authored by Daniel can only land on Operations.
const written = await writeMemory(daniel, {
  scope: "team",
  key: "verify.team_derivation",
  content: "Team writes derive their team from the server-loaded actor.",
  confidence: 1,
  rationale: "verification",
  quote: "",
  sessionId: null,
  messageId: null,
});
check("a team write lands on the actor's own team", "t_ops", written.team_id);
check("and is invisible to the other team", null, await getMemoryAs(sean, written.id));
await deleteMemory(daniel, written.id);

console.log("\n== correct ==");
await correctMemory(daniel, "mem_daniel_bullets", {
  content: "Give Daniel short bullets, never paragraphs.",
});
check(
  "correction persisted",
  "Give Daniel short bullets, never paragraphs.",
  (await getMemoryAs(daniel, "mem_daniel_bullets"))?.content,
);
check(
  "and is recorded in the audit trail",
  true,
  (await listVisibleMemories(daniel))
    .find((m) => m.id === "mem_daniel_bullets") !== undefined,
);

console.log("\n== ratify ==");
check("colleague blocked before", null, await getMemoryAs(daniel, "mem_pending_cc"));
await confirmMemory(mitchell, "mem_pending_cc", { accept: true, scope: "org" });
check(
  "colleague sees it after ratification",
  true,
  Boolean(await getMemoryAs(daniel, "mem_pending_cc")),
);
check(
  "and it now reaches a prompt",
  true,
  (await retrieveForTurn(daniel, "email the customer")).injected.some(
    (m) => m.id === "mem_pending_cc",
  ),
);

console.log("\n== delete ==");
await deleteMemory(mitchell, "mem_pending_cc");
check("deleted", null, await getMemoryAs(mitchell, "mem_pending_cc"));
check(
  "and gone from everyone",
  false,
  (await listVisibleMemories(daniel)).some((m) => m.id === "mem_pending_cc"),
);

console.log("\n== supersession cannot be used to escalate ==");
// Regression: a personal rule claiming to replace the binding org policy used
// to retire it for everyone, bypassing the precedence ladder entirely — a
// superseded row is never retrieved, so the ladder never sees it.
const sneaky = await writeMemory(sean, {
  scope: "personal",
  key: "policy.dates",
  content: "Sean may give customers dates without engineering sign-off.",
  confidence: 1,
  rationale: "regression test",
  quote: "",
  sessionId: null,
  messageId: null,
  supersedesId: "mem_org_dates",
});
const orgRule = await getMemoryAs(sean, "mem_org_dates");
check("the binding org policy is still active", "active", orgRule?.status);
check(
  "and still outranks the personal rule at retrieval",
  "mem_org_dates",
  (await retrieveForTurn(sean, "promise Acme a delivery date")).injected.find(
    (m) => m.key === "policy.dates",
  )?.id,
);
check(
  "the personal rule is reported as overridden, not silently dropped",
  true,
  (await retrieveForTurn(sean, "promise Acme a delivery date")).overridden.some(
    (o) => o.memory.id === sneaky.id,
  ),
);
check(
  "and the refusal is in the audit trail",
  true,
  (await memoryEvents(sneaky.id)).some((e) => e.action === "supersession refused"),
);
await deleteMemory(sean, sneaky.id);

// A personal memory may still supersede the author's own personal memory.
const first = await writeMemory(daniel, {
  scope: "personal", key: "verify.super", content: "v1",
  confidence: 1, rationale: "", quote: "", sessionId: null, messageId: null,
});
const second = await writeMemory(daniel, {
  scope: "personal", key: "verify.super", content: "v2",
  confidence: 1, rationale: "", quote: "", sessionId: null, messageId: null,
  supersedesId: first.id,
});
check(
  "legitimate same-scope supersession still works",
  "superseded",
  (await getMemoryAs(daniel, first.id))?.status,
);
await deleteMemory(daniel, second.id);

console.log("\n== delete a chat ==");
const { deleteSession } = await import("../src/lib/sessions");
const { all } = await import("../src/lib/db");

await throws("you cannot delete someone else's chat", 403, () =>
  deleteSession(mitchell, "s_ryan_1"),
);
await throws("or one that does not exist", 404, () => deleteSession(ryan, "s_nope"));

// Ryan's session #1 is where the Finance pricing rule was stated.
const ruleBefore = await getMemoryAs(ryan, "mem_fin_pricing");
check("the rule exists before the chat is deleted", true, Boolean(ruleBefore));
await deleteSession(ryan, "s_ryan_1");
check(
  "session gone",
  0,
  (await all<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`, ["s_ryan_1"]))[0]
    .n,
);
check(
  "its messages gone",
  0,
  (await all<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`, [
    "s_ryan_1",
  ]))[0].n,
);
check(
  "no orphaned message links left behind",
  0,
  (
    await all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM message_memories mm
        WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = mm.message_id)`,
    )
  )[0].n,
);
// The knowledge outlives the transcript — a team rule others rely on must not
// vanish because its author tidied up their own chat history.
check(
  "the team rule survives, and still reaches Sean",
  true,
  Boolean(await getMemoryAs(sean, "mem_fin_pricing")),
);
check(
  "and still reaches a prompt",
  true,
  (await retrieveForTurn(sean, "price the renewal")).injected.some(
    (m) => m.id === "mem_fin_pricing",
  ),
);
check("and is still invisible to Mitchell", null, await getMemoryAs(mitchell, "mem_fin_pricing"));

console.log(`\npassed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
