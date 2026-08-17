"use client";

import type { AppState } from "@/lib/state";

export default function Sidebar({
  state,
  onSelectSession,
  onSwitchUser,
  onNewSession,
  onDeleteSession,
}: {
  state: AppState;
  onSelectSession: (userId: string, sessionId: string) => void;
  onSwitchUser: (userId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string, title: string) => void;
}) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--line)] bg-white">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Agent Memory
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-[var(--muted)]">Acting as</label>
          <select
            value={state.actor.id}
            onChange={(e) => onSwitchUser(e.target.value)}
            className="flex-1 rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-sm font-medium outline-none focus:border-[var(--accent)]"
          >
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.teamNames[0] ?? "No team"}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          Everyone&apos;s chats are listed. Opening someone else&apos;s session switches you to
          them — memory visibility always follows whoever you are acting as.
        </p>
        <button
          onClick={() => onSelectSession("u_sean", "s_sean_3")}
          className="mt-2.5 w-full rounded-md bg-[var(--accent)] px-2.5 py-2 text-[12px] font-medium text-white transition hover:opacity-90"
        >
          Run the guided demo →
        </button>
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--muted)]">
          Opens Sean&apos;s empty chat, where both required demos are one click each.
        </p>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
        {state.users.map((u) => {
          const isActor = u.id === state.actor.id;
          return (
            <section key={u.id} className="mb-5">
              <header className="mb-2 flex items-center gap-2 px-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: u.color }}
                />
                <h2
                  className={`text-sm ${isActor ? "font-bold" : "font-semibold text-[#33383d]"}`}
                >
                  {u.name}&apos;s chats
                </h2>
                {u.teamNames.map((t) => (
                  <span
                    key={t}
                    className="rounded border border-[var(--line)] bg-[#f3f5f7] px-1.5 py-[1px] text-[10px] font-medium text-[var(--muted)]"
                  >
                    {t} Team
                  </span>
                ))}
              </header>

              <ul className="space-y-1">
                {(state.sessionsByUser[u.id] ?? []).map((s) => {
                  const active = s.id === state.activeSessionId;
                  return (
                    <li key={s.id} className="group relative">
                      <button
                        onClick={() => onSelectSession(u.id, s.id)}
                        className={`w-full truncate rounded-md border py-2 pl-2.5 pr-8 text-left text-[13px] transition ${
                          active
                            ? "border-[var(--accent)] bg-[#eef3fe] font-medium text-[var(--accent)]"
                            : "border-[var(--line)] bg-white hover:bg-[#f6f7f9]"
                        }`}
                        title={s.title}
                      >
                        {s.title}
                      </button>
                      {isActor && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(s.id, s.title);
                          }}
                          aria-label={`Delete ${s.title}`}
                          title="Delete chat"
                          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted)] opacity-0 transition focus:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent)] group-hover:opacity-100 hover:bg-[#fdecea] hover:text-[#c0392b]"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      )}
                    </li>
                  );
                })}
                {isActor && (
                  <li>
                    <button
                      onClick={onNewSession}
                      className="w-full rounded-md border border-dashed border-[var(--line)] px-2.5 py-2 text-left text-[13px] text-[var(--muted)] hover:bg-[#f6f7f9]"
                    >
                      + New chat
                    </button>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="border-t border-[var(--line)] px-4 py-2.5 text-[11px] text-[var(--muted)]">
        {state.modelConfigured ? <>Model: {state.modelLabel}</> : <>{state.modelLabel}</>}
      </div>
    </aside>
  );
}
