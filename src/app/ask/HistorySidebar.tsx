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
    if (res.ok) onSelect(json);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setHistory((prev) => prev.filter((h) => h.id !== id));
    await fetch(`/api/history/${id}`, { method: "DELETE" });
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-3 border-l border-cyan/20 px-4 py-10 md:flex">
      <h2 className="font-heading text-sm font-medium text-offwhite/60">History</h2>
      {history.length === 0 ? (
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
      )}
    </aside>
  );
}
