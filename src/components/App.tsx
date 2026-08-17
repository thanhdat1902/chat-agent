"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { AppState } from "@/lib/state";
import Sidebar from "./Sidebar";
import Conversation from "./Conversation";
import MemoryPanel from "./MemoryPanel";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";

/** Marks a locally-appended message that the server has not confirmed yet. */
export const PENDING_PREFIX = "pending_";

export interface ChatMeta {
  injected: string[];
  overridden: { id: string; beatenBy: string }[];
  droppedForBudget: string[];
  visibleCount: number;
}

export default function App({ initial }: { initial: AppState }) {
  const [state, setState] = useState<AppState>(initial);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastMeta, setLastMeta] = useState<ChatMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  /**
   * Session switches used to wait on a full round trip before anything moved,
   * which read as a freeze. The sidebar and header can be updated from data
   * the client already holds, so selection is applied immediately and only the
   * transcript and memory panel wait — with a visible loading state.
   *
   * Requests are sequenced so a slow response for a session you already
   * navigated away from cannot overwrite a newer one.
   */
  const requestSeq = useRef(0);

  const refresh = useCallback(
    async (userId: string, sessionId: string | null, optimistic = false) => {
      const seq = ++requestSeq.current;
      if (!optimistic) setLoading(true);
      try {
        const qs = new URLSearchParams({ userId });
        if (sessionId) qs.set("sessionId", sessionId);
        const res = await fetch(`/api/state?${qs}`, { cache: "no-store" });
        const next = (await res.json()) as AppState;
        if (seq !== requestSeq.current) return; // superseded by a newer click
        setState(next);
        setLastMeta(null);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [],
  );

  const selectSession = useCallback(
    (userId: string, sessionId: string) => {
      if (sessionId === state.activeSessionId && userId === state.actor.id) return;
      const nextActor = state.users.find((u) => u.id === userId) ?? state.actor;
      // Paint the selection now from what we already have; the transcript and
      // the memory panel fill in when the fetch lands.
      setState((s) => ({ ...s, actor: nextActor, activeSessionId: sessionId, messages: [] }));
      setLastMeta(null);
      setLoading(true);
      void refresh(userId, sessionId, true);
    },
    [refresh, state.activeSessionId, state.actor, state.users],
  );

  /** Switching by name is optimistic too, so the header moves on click. */
  const switchUser = useCallback(
    (userId: string) => {
      if (userId === state.actor.id) return;
      const nextActor = state.users.find((u) => u.id === userId);
      if (!nextActor) return;
      const firstSession = state.sessionsByUser[userId]?.[0]?.id ?? null;
      setState((s) => ({
        ...s,
        actor: nextActor,
        activeSessionId: firstSession,
        messages: [],
      }));
      setLastMeta(null);
      setLoading(true);
      void refresh(userId, firstSession, true);
    },
    [refresh, state.actor.id, state.users, state.sessionsByUser],
  );

  /**
   * A turn does real work before it can answer — extraction, retrieval, then
   * generation — so waiting for the response to render the user's own message
   * left them staring at an empty box wondering whether Enter registered. The
   * message is appended locally the moment it is sent, and replaced when the
   * server's authoritative state arrives. `PENDING_PREFIX` marks the local
   * copy so it can be styled as in-flight and rolled back if the send fails.
   */
  const send = useCallback(
    async (content: string) => {
      const sessionId = state.activeSessionId;
      if (!sessionId || busy) return;

      const pendingId = `${PENDING_PREFIX}${Date.now()}`;
      setState((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: pendingId,
            session_id: sessionId,
            role: "user" as const,
            content,
            created_at: new Date().toISOString(),
            used_memory_ids: [],
            created_memory_ids: [],
          },
        ],
      }));
      setBusy(true);
      setError(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: state.actor.id, sessionId, content }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Request failed");
        setState(data.state as AppState);
        setLastMeta(data.retrieval as ChatMeta);
      } catch (e) {
        setError((e as Error).message);
        // The turn never landed, so take the local copy back out rather than
        // showing a message that was not stored.
        setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== pendingId) }));
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

  /**
   * Opens the confirmation dialog and owns the busy/close/error handling, so
   * every destructive action in the app funnels through one path.
   */
  const requestConfirm = useCallback(
    (opts: Omit<ConfirmRequest, "onConfirm"> & { run: () => Promise<Response> }) => {
      setConfirm({
        ...opts,
        onConfirm: async () => {
          setConfirmBusy(true);
          setError(null);
          try {
            const res = await opts.run();
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Request failed");
            setState(data as AppState);
            setLastMeta(null);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setConfirmBusy(false);
            setConfirm(null);
          }
        },
      });
    },
    [],
  );

  const requestDeleteSession = useCallback(
    (sessionId: string, title: string) => {
      requestConfirm({
        title: "Delete this chat?",
        body: `“${title}” and every message in it will be removed.`,
        note: "Rules the agent learned from this conversation are kept — they may be in use by your team. Remove those separately in the memory panel.",
        confirmLabel: "Delete chat",
        run: () =>
          fetch(
            `/api/sessions/${sessionId}?${new URLSearchParams({
              userId: state.actor.id,
              sessionId,
            })}`,
            { method: "DELETE" },
          ),
      });
    },
    [state.actor.id, requestConfirm],
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
        onSwitchUser={switchUser}
        onNewSession={newSession}
        onDeleteSession={requestDeleteSession}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Conversation
          state={state}
          session={activeSession}
          busy={busy}
          loading={loading}
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

      <MemoryPanel
        state={state}
        lastMeta={lastMeta}
        onMutate={mutate}
        onRequestConfirm={requestConfirm}
      />

      <ConfirmDialog
        request={confirm}
        busy={confirmBusy}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
