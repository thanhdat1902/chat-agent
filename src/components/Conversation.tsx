"use client";

import { useEffect, useRef, useState } from "react";
import type { AppState, MemoryView } from "@/lib/state";
import type { ChatSession, Scope } from "@/lib/types";
import { DEMO_PROMPTS } from "./demos";
import { PENDING_PREFIX, type ChatMeta } from "./App";

const SCOPE_STYLE: Record<string, string> = {
  org: "bg-[#fdf1e3] text-[#9a5b13] border-[#f0d6b4]",
  team: "bg-[#e9f3ec] text-[#1c6b39] border-[#c6e2d0]",
  personal: "bg-[#eef1fd] text-[#3b4bb3] border-[#ccd4f5]",
};

export function ScopeTag({ memory }: { memory: MemoryView }) {
  const label =
    memory.scope === "team"
      ? `Team · ${memory.teamName ?? ""}`
      : memory.scope === "org"
        ? memory.binding
          ? "Org · binding"
          : "Org"
        : "Personal";
  return (
    <span
      className={`rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${SCOPE_STYLE[memory.scope]}`}
    >
      {label}
    </span>
  );
}

export default function Conversation({
  state,
  session,
  busy,
  loading,
  error,
  lastMeta,
  onSend,
  onConfirm,
}: {
  state: AppState;
  session: ChatSession | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  lastMeta: ChatMeta | null;
  onSend: (content: string) => void;
  onConfirm: (
    memoryId: string,
    body: { accept: boolean; scope?: Scope; binding?: boolean },
  ) => void;
}) {
  const [draft, setDraft] = useState("");
  const [openUsed, setOpenUsed] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const byId = new Map(state.memories.map((m) => [m.id, m]));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages.length, busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  const demos = DEMO_PROMPTS[state.actor.id] ?? [];

  return (
    <>
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-white px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {session?.title ?? "No session"}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {state.actor.name} · {state.actor.teamNames[0] ?? "No team"} ·{" "}
            {state.memories.filter((m) => m.status === "active").length} memories in scope
          </p>
        </div>
        {lastMeta && (
          <div className="shrink-0 text-right text-[11px] text-[var(--muted)]">
            last turn: {lastMeta.injected.length} injected / {lastMeta.visibleCount} visible
            {lastMeta.overridden.length > 0 && ` · ${lastMeta.overridden.length} overridden`}
            {lastMeta.droppedForBudget.length > 0 &&
              ` · ${lastMeta.droppedForBudget.length} dropped for budget`}
          </div>
        )}
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {loading && (
            <div className="space-y-4" aria-live="polite" aria-busy="true">
              <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
                Loading conversation…
              </div>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="h-12 animate-pulse rounded-2xl bg-[#eef1f4]"
                    style={{ width: `${[62, 44, 72][i]}%` }}
                  />
                </div>
              ))}
            </div>
          )}

          {!loading && state.messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--line)] bg-white p-5">
              <h3 className="text-sm font-semibold">Fresh chat as {state.actor.name}</h3>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                Nothing has been said in this session. Anything the agent knows here came from
                somewhere else — which is the point.
              </p>
              {demos.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {demos.map((d) => (
                    <li key={d.label}>
                      <button
                        onClick={() => onSend(d.prompt)}
                        disabled={busy}
                        className="w-full rounded-md border border-[var(--line)] bg-[#fbfcfd] px-3 py-2.5 text-left transition hover:border-[var(--accent)] hover:bg-[#f2f6ff] disabled:opacity-50"
                      >
                        <div className="text-[12px] font-semibold text-[var(--accent)]">
                          {d.label}
                        </div>
                        <div className="mt-1 text-[13px]">&ldquo;{d.prompt}&rdquo;</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                          {d.note}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!loading && state.messages.map((m) => {
            const pending = state.memories.filter(
              (mem) => mem.source_message_id === m.id && mem.status === "pending",
            );
            const created = state.memories.filter(
              (mem) => mem.source_message_id === m.id && mem.status !== "pending",
            );
            const used = m.used_memory_ids
              .map((idv) => byId.get(idv))
              .filter(Boolean) as MemoryView[];

            return (
              <div key={m.id}>
                <div
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed transition-opacity ${
                      m.role === "user"
                        ? "bg-[var(--accent)] text-white"
                        : "panel rounded-tl-sm"
                    } ${m.id.startsWith(PENDING_PREFIX) ? "opacity-70" : ""}`}
                  >
                    {m.content}
                  </div>
                </div>

                {m.role === "assistant" && used.length > 0 && (
                  <div className="mt-1.5">
                    <button
                      onClick={() => setOpenUsed(openUsed === m.id ? null : m.id)}
                      className="text-[11px] font-medium text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
                    >
                      {used.length} {used.length === 1 ? "memory" : "memories"} shaped this reply
                    </button>
                    {openUsed === m.id && (
                      <ul className="mt-2 space-y-1.5 rounded-md border border-[var(--line)] bg-white p-3">
                        {used.map((mem) => (
                          <li key={mem.id} className="flex items-start gap-2 text-[12px]">
                            <ScopeTag memory={mem} />
                            <span className="flex-1">
                              {mem.content}
                              <span className="ml-1 text-[var(--muted)]">
                                — {mem.authorName} set this,{" "}
                                {new Date(mem.created_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {created.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                    {created.map((mem) => (
                      <span
                        key={mem.id}
                        className="flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[11px]"
                        title={mem.rationale}
                      >
                        <ScopeTag memory={mem} />
                        <span className="text-[var(--muted)]">remembered</span>
                      </span>
                    ))}
                  </div>
                )}

                {pending.map((mem) => (
                  <div
                    key={mem.id}
                    className="mt-2 rounded-md border border-[#f0d6b4] bg-[#fffaf2] p-3"
                  >
                    <div className="text-[12px] font-semibold text-[#9a5b13]">
                      Confirm scope before this binds anyone
                    </div>
                    <div className="mt-1 text-[13px]">{mem.content}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                      {mem.rationale}
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(["personal", "team", "org"] as Scope[])
                        .filter((s) => s !== "team" || state.actor.teamIds.length > 0)
                        .map((s) => (
                          <button
                            key={s}
                            onClick={() =>
                              onConfirm(mem.id, {
                                accept: true,
                                scope: s,
                                binding: false,
                              })
                            }
                            className={`rounded border px-2 py-1 text-[11px] font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)] ${
                              mem.proposed_scope === s
                                ? "border-[var(--accent)] bg-[#eef3fe] text-[var(--accent)]"
                                : "border-[var(--line)] bg-white"
                            }`}
                          >
                            {s === "team"
                              ? `Just ${state.actor.teamNames[0]}`
                              : s === "org"
                                ? "Everyone"
                                : "Just me"}
                            {mem.proposed_scope === s && " · proposed"}
                          </button>
                        ))}
                      <button
                        onClick={() =>
                          onConfirm(mem.id, { accept: true, scope: "org", binding: true })
                        }
                        className="rounded border border-[var(--line)] bg-white px-2 py-1 text-[11px] font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        Everyone · binding policy
                      </button>
                      <button
                        onClick={() => onConfirm(mem.id, { accept: false })}
                        className="rounded border border-[var(--line)] bg-white px-2 py-1 text-[11px] text-[var(--muted)] hover:border-[#c0392b] hover:text-[#c0392b]"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {busy && (
            <div className="flex justify-start">
              <div className="panel flex gap-1 rounded-2xl rounded-tl-sm px-4 py-3">
                <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
                <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
                <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-[#f5c6c0] bg-[#fdf0ef] px-3 py-2 text-[13px] text-[#a02c20]">
              {error}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[var(--line)] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            disabled={loading}
            placeholder={
              loading ? "Loading…" : `Type to message as ${state.actor.name}…`
            }
            className="scroll-thin max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-[var(--line)] px-3.5 py-3 text-[14px] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={submit}
            disabled={busy || loading || !draft.trim()}
            className="h-[44px] rounded-lg bg-[var(--accent)] px-5 text-sm font-medium text-white transition disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
