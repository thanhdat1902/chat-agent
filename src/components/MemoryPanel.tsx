"use client";

import { useState } from "react";
import type { AppState, MemoryView } from "@/lib/state";
import type { Scope } from "@/lib/types";
import { ScopeTag } from "./Conversation";
import type { ChatMeta } from "./App";
import type { ConfirmRequest } from "./ConfirmDialog";

export type RequestConfirm = (
  opts: Omit<ConfirmRequest, "onConfirm"> & { run: () => Promise<Response> },
) => void;

type Tab = "memory" | "precedence" | "leak";


export default function MemoryPanel({
  state,
  lastMeta,
  onMutate,
  onRequestConfirm,
}: {
  state: AppState;
  lastMeta: ChatMeta | null;
  onMutate: (input: RequestInfo, init?: RequestInit) => Promise<void>;
  onRequestConfirm: RequestConfirm;
}) {
  const [tab, setTab] = useState<Tab>("memory");

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--line)] bg-white">
      <nav className="flex border-b border-[var(--line)]">
        {(
          [
            ["memory", `What ${state.actor.name} knows`],
            ["precedence", "Precedence"],
            ["leak", "Leak test"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-3 py-2.5 text-[12px] font-medium transition ${
              tab === key
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {tab === "memory" && (
          <MemoryList
            state={state}
            lastMeta={lastMeta}
            onMutate={onMutate}
            onRequestConfirm={onRequestConfirm}
          />
        )}
        {tab === "precedence" && <Precedence state={state} />}
        {tab === "leak" && <LeakTest state={state} />}
      </div>
    </aside>
  );
}

function MemoryList({
  state,
  lastMeta,
  onMutate,
  onRequestConfirm,
}: {
  state: AppState;
  lastMeta: ChatMeta | null;
  onMutate: (input: RequestInfo, init?: RequestInit) => Promise<void>;
  onRequestConfirm: RequestConfirm;
}) {
  const groups: [string, MemoryView[]][] = [
    ["Personal", state.memories.filter((m) => m.scope === "personal")],
    ["Team", state.memories.filter((m) => m.scope === "team")],
    ["Organization", state.memories.filter((m) => m.scope === "org")],
  ];

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-[var(--line)] bg-[#f8fafc] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
        This list is the result of the same SQL predicate the agent&apos;s retrieval uses.
        Rules {state.actor.name} is not entitled to are not hidden here — they are not
        returned by the query.
      </p>

      {groups.map(([label, items]) => (
        <section key={label}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {label} · {items.length}
          </h3>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--line)] px-3 py-3 text-[12px] text-[var(--muted)]">
              Nothing at this scope for {state.actor.name}.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  state={state}
                  used={lastMeta?.injected.includes(m.id) ?? false}
                  onMutate={onMutate}
                  onRequestConfirm={onRequestConfirm}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function MemoryCard({
  memory,
  state,
  used,
  onMutate,
  onRequestConfirm,
}: {
  memory: MemoryView;
  state: AppState;
  used: boolean;
  onMutate: (input: RequestInfo, init?: RequestInit) => Promise<void>;
  onRequestConfirm: RequestConfirm;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.content);
  const [scope, setScope] = useState<Scope>(memory.scope);
  const [showTrace, setShowTrace] = useState(false);

  const dim = memory.status === "superseded" || Boolean(memory.overriddenBy);

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        used ? "border-[var(--accent)] bg-[#f5f8ff]" : "border-[var(--line)] bg-white"
      } ${dim ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <ScopeTag memory={memory} />
        <span className="rounded bg-[#f1f3f5] px-1.5 py-[1px] font-mono text-[10px] text-[var(--muted)]">
          {memory.key}
        </span>
        {used && (
          <span className="rounded bg-[var(--accent)] px-1.5 py-[1px] text-[10px] font-semibold text-white">
            used last turn
          </span>
        )}
        {memory.status === "pending" && (
          <span className="rounded border border-[#f0d6b4] bg-[#fffaf2] px-1.5 py-[1px] text-[10px] font-semibold text-[#9a5b13]">
            awaiting confirmation
          </span>
        )}
        {memory.status === "superseded" && (
          <span className="rounded border border-[var(--line)] px-1.5 py-[1px] text-[10px] text-[var(--muted)]">
            superseded
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded border border-[var(--line)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="w-full rounded border border-[var(--line)] px-2 py-1.5 text-[12px]"
          >
            <option value="personal">Personal — only {state.actor.name}</option>
            {state.actor.teamNames[0] && (
              <option value="team">Team — {state.actor.teamNames[0]}</option>
            )}
            <option value="org">Organization — everyone</option>
          </select>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                await onMutate(`/api/memories/${memory.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    userId: state.actor.id,
                    sessionId: state.activeSessionId,
                    content: text,
                    scope,
                  }),
                });
                setEditing(false);
              }}
              className="rounded bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white"
            >
              Save correction
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setText(memory.content);
                setScope(memory.scope);
              }}
              className="rounded border border-[var(--line)] px-2.5 py-1 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] leading-relaxed">{memory.content}</p>
      )}

      {memory.overriddenBy && (
        <p className="mt-1.5 rounded border border-[#f0d6b4] bg-[#fffaf2] px-2 py-1 text-[11px] text-[#9a5b13]">
          Overridden for {state.actor.name} by a more specific rule ({memory.overriddenBy.scope}
          ): “{memory.overriddenBy.content}”. Not sent to the model.
        </p>
      )}
      {memory.supersededBy && (
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">
          Replaced by: “{memory.supersededBy.content}”
        </p>
      )}

      <div className="mt-2 text-[11px] text-[var(--muted)]">
        {memory.authorName} set this,{" "}
        {new Date(memory.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}{" "}
        · precedence {memory.precedence}
      </div>

      <button
        onClick={() => setShowTrace(!showTrace)}
        className="mt-1.5 text-[11px] text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
      >
        {showTrace ? "Hide" : "Show"} provenance
      </button>

      {showTrace && (
        <div className="mt-2 space-y-1.5 rounded border border-[var(--line)] bg-[#fbfcfd] p-2 text-[11px] leading-relaxed">
          {memory.source_quote && (
            <p>
              <span className="font-semibold">Said:</span> “{memory.source_quote}”
            </p>
          )}
          <p>
            <span className="font-semibold">Scope chosen because:</span> {memory.rationale}
          </p>
          <p>
            <span className="font-semibold">Confidence:</span>{" "}
            {(memory.confidence * 100).toFixed(0)}%
          </p>
          <ul className="mt-1 space-y-0.5">
            {memory.events.map((e) => (
              <li key={e.id} className="text-[var(--muted)]">
                {new Date(e.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                — {e.action}
                {e.detail ? `: ${e.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] font-medium text-[var(--accent)]"
          >
            Correct
          </button>
        )}
        <button
          onClick={() =>
            onRequestConfirm({
              title: "Delete this memory?",
              body: `The agent will stop following “${memory.content}”.`,
              note:
                memory.scope === "personal"
                  ? "This rule only affects you."
                  : `This rule is in force for ${
                      memory.scope === "org" ? "everyone" : `the ${memory.teamName} team`
                    }. Deleting it removes it for them too.`,
              confirmLabel: "Delete memory",
              run: () =>
                fetch(
                  `/api/memories/${memory.id}?${new URLSearchParams({
                    userId: state.actor.id,
                    sessionId: state.activeSessionId ?? "",
                  })}`,
                  { method: "DELETE" },
                ),
            })
          }
          className="text-[11px] font-medium text-[#c0392b]"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function Precedence({ state }: { state: AppState }) {
  const conflicts = state.memories.filter((m) => m.overriddenBy);
  return (
    <div className="space-y-4 text-[13px] leading-relaxed">
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          When rules disagree
        </h3>
        <ol className="space-y-1.5">
          {state.ladder.map((l) => (
            <li
              key={l.rank}
              className="flex gap-2 rounded-md border border-[var(--line)] px-2.5 py-2"
            >
              <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#f1f3f5] text-[11px] font-bold">
                {l.rank}
              </span>
              <span>
                <span className="font-semibold">{l.label}</span>
                <span className="block text-[11px] text-[var(--muted)]">{l.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-md border border-[var(--line)] bg-[#f8fafc] p-3 text-[12px] leading-relaxed text-[var(--muted)]">
        <span className="font-semibold text-[var(--ink)]">Why this order.</span> The person
        closest to the situation has the most context, so specificity wins: a personal
        preference beats a team default and a team default beats an org default. The
        exception exists because some org rules are not defaults at all — they are
        commitments the company has made. Those are marked <em>binding</em> when they are
        ratified and cannot be overridden, otherwise anyone could opt out of a compliance
        rule by stating a preference. Conflicts are resolved by shared key <em>before</em>{" "}
        the prompt is built: the model only ever sees the winner.
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Live conflicts for {state.actor.name} · {conflicts.length}
        </h3>
        {conflicts.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">
            No two rules in scope currently contradict each other.
          </p>
        ) : (
          <ul className="space-y-2">
            {conflicts.map((m) => (
              <li key={m.id} className="rounded-md border border-[var(--line)] p-2.5 text-[12px]">
                <div className="text-[var(--muted)] line-through">{m.content}</div>
                <div className="mt-1 font-medium">↳ {m.overriddenBy!.content}</div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">
                  key <span className="font-mono">{m.key}</span> · {m.scope} loses to{" "}
                  {m.overriddenBy!.scope}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ProbeResult {
  status: number;
  body: Record<string, unknown>;
}

function LeakTest({ state }: { state: AppState }) {
  // Probe targets are the memories the CURRENT actor can see. That is the
  // honest shape of the test: "I can read this — can they?" It also means the
  // panel works on a blank database, where no fixed seed ids exist.
  const targets = state.memories;
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const others = state.users.filter((u) => u.id !== state.actor.id);
  const [asUser, setAsUser] = useState(others[0]?.id ?? state.actor.id);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/memories/${target}?userId=${asUser}`, {
        cache: "no-store",
      });
      setResult({ status: res.status, body: await res.json() });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 text-[13px]">
      <p className="rounded-md border border-[var(--line)] bg-[#f8fafc] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
        Ask the API for a specific memory <em>as</em> a specific user — including memory ids
        the user has no business knowing. This is the same code path the agent&apos;s
        retrieval and the inspector use, so a pass here is a pass everywhere.
      </p>

      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Memory {state.actor.name} can see
        </span>
        {targets.length === 0 ? (
          <p className="mt-1 rounded border border-dashed border-[var(--line)] px-2 py-2 text-[12px] text-[var(--muted)]">
            {state.actor.name} has no memories yet. Create one in chat, then probe it.
          </p>
        ) : (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--line)] px-2 py-1.5 text-[12px]"
          >
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.scope === "team" ? `Team · ${m.teamName}` : m.scope === "org" ? "Org" : "Personal"}
                {" — "}
                {m.content.slice(0, 52)}
                {m.content.length > 52 ? "…" : ""}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Requested by
        </span>
        <select
          value={asUser}
          onChange={(e) => setAsUser(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--line)] px-2 py-1.5 text-[12px]"
        >
          {state.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.teamNames[0] ?? "no team"}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={run}
        disabled={running || !target}
        className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run probe"}
      </button>

      {result && (
        <div
          className={`rounded-md border p-3 ${
            result.status === 200
              ? "border-[#c6e2d0] bg-[#f2f9f4]"
              : "border-[#f5c6c0] bg-[#fdf0ef]"
          }`}
        >
          <div className="text-[12px] font-semibold">
            HTTP {result.status} —{" "}
            {result.status === 200 ? "allowed" : "not visible to this user"}
          </div>
          <pre className="scroll-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
