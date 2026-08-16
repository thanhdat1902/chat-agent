"use client";

import { useCallback, useMemo, useState } from "react";
import type { AppState } from "@/lib/state";
import Sidebar from "./Sidebar";
import Conversation from "./Conversation";
import MemoryPanel from "./MemoryPanel";

export interface ChatMeta {
  injected: string[];
  overridden: { id: string; beatenBy: string }[];
  droppedForBudget: string[];
  visibleCount: number;
}

export default function App({ initial }: { initial: AppState }) {
  const [state, setState] = useState<AppState>(initial);
  const [busy, setBusy] = useState(false);
  const [lastMeta, setLastMeta] = useState<ChatMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (userId: string, sessionId: string | null) => {
      const qs = new URLSearchParams({ userId });
      if (sessionId) qs.set("sessionId", sessionId);
      const res = await fetch(`/api/state?${qs}`, { cache: "no-store" });
      const next = (await res.json()) as AppState;
      setState(next);
      setLastMeta(null);
    },
    [],
  );

  const selectSession = useCallback(
    (userId: string, sessionId: string) => {
      void refresh(userId, sessionId);
    },
    [refresh],
  );

  const send = useCallback(
    async (content: string) => {
      if (!state.activeSessionId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: state.actor.id,
            sessionId: state.activeSessionId,
            content,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Request failed");
        setState(data.state as AppState);
        setLastMeta(data.retrieval as ChatMeta);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [state.activeSessionId, state.actor.id, busy],
  );

  const newSession = useCallback(async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: state.actor.id }),
    });
    setState((await res.json()) as AppState);
    setLastMeta(null);
  }, [state.actor.id]);

  const mutate = useCallback(
    async (input: RequestInfo, init?: RequestInit) => {
      const res = await fetch(input, init);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setState(data as AppState);
    },
    [],
  );

  const activeSession = useMemo(
    () =>
      Object.values(state.sessionsByUser)
        .flat()
        .find((s) => s.id === state.activeSessionId) ?? null,
    [state.sessionsByUser, state.activeSessionId],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        state={state}
        onSelectSession={selectSession}
        onSwitchUser={(u) => void refresh(u, null)}
        onNewSession={newSession}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Conversation
          state={state}
          session={activeSession}
          busy={busy}
          error={error}
          lastMeta={lastMeta}
          onSend={send}
          onConfirm={(memoryId, body) =>
            mutate(`/api/memories/${memoryId}/confirm`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                userId: state.actor.id,
                sessionId: state.activeSessionId,
                ...body,
              }),
            })
          }
        />
      </main>

      <MemoryPanel state={state} lastMeta={lastMeta} onMutate={mutate} />
    </div>
  );
}
