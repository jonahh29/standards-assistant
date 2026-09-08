"use client";

import { useEffect, useState } from "react";

export interface HistorySummary {
  id: string;
  title: string;
  created_at: string;
}

interface Props {
  refreshKey: number;
  onSelect: (data: { question: string; answer: string; citations: unknown[] }) => void;
}

export function HistorySidebar({ refreshKey, onSelect }: Props) {
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // See FavouritesSidebar.tsx for why this exists — same mobile bottom-bar pattern,
  // this component renders the right half.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/history")
      .then((res) => res.json())
      .then((json) => setHistory(json.history ?? []));
  }, [refreshKey]);

  async function handleSelect(id: string) {
    setLoadingId(id);
    const res = await fetch(`/api/history/${id}`);
    const json = await res.json();
    setLoadingId(null);
    if (res.ok) {
      onSelect(json);
      setMobileOpen(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setHistory((prev) => prev.filter((h) => h.id !== id));
    await fetch(`/api/history/${id}`, { method: "DELETE" });
  }

  const list =
    history.length === 0 ? (
      <p className="text-xs text-offwhite/40">Questions you ask will show up here.</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {history.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => handleSelect(h.id)}
              disabled={loadingId === h.id}
              className="group flex w-full items-start justify-between gap-1 rounded px-2 py-1.5 text-left text-sm text-offwhite/80 hover:bg-cyan/10 hover:text-cyan disabled:opacity-50"
            >
              <span>{loadingId === h.id ? "Loading…" : h.title}</span>
              <span
                onClick={(e) => handleDelete(e, h.id)}
                className="shrink-0 text-offwhite/30 opacity-0 hover:text-amber group-hover:opacity-100"
                aria-label={`Remove ${h.title}`}
              >
                ×
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col gap-3 border-l border-cyan/20 px-4 py-10 md:flex">
        <h2 className="font-heading text-sm font-medium text-offwhite/60">History</h2>
        {list}
      </aside>

      {/* Mobile: right half of the fixed bottom bar (FavouritesSidebar renders the
          left half). */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-0 right-0 z-40 flex w-1/2 items-center justify-center gap-1.5 border-t border-cyan/20 bg-navy py-3 font-mono text-xs text-cyan md:hidden"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        🕘 History
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-navy/95 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="flex flex-1 flex-col gap-3 overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-sm font-medium text-offwhite/60">History</h2>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="px-2 py-1 text-lg text-offwhite/60 hover:text-cyan"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {list}
          </div>
        </div>
      )}
    </>
  );
}
