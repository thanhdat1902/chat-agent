"use client";

import { useEffect, useRef } from "react";

export interface ConfirmRequest {
  title: string;
  body: string;
  note?: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

export default function ConfirmDialog({
  request,
  busy,
  onCancel,
}: {
  request: ConfirmRequest | null;
  busy: boolean;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, busy, onCancel]);

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-[380px] rounded-lg border border-[var(--line)] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-[15px] font-semibold">
          {request.title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#3d444b]">{request.body}</p>
        <p className="mt-2 text-[12px] font-medium text-[#c0392b]">
          This cannot be undone.
        </p>
        {request.note && (
          <p className="mt-2 rounded border border-[var(--line)] bg-[#f8fafc] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {request.note}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-[13px] font-medium hover:bg-[#f6f7f9] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={() => void request.onConfirm()}
            disabled={busy}
            className="rounded-md bg-[#c0392b] px-3 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Deleting…" : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
