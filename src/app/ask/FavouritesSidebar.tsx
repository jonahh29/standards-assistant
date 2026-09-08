"use client";

import { useEffect, useState } from "react";

export interface FavouriteSummary {
  id: string;
  title: string;
  created_at: string;
}

interface Props {
  refreshKey: number;
  onSelect: (data: { question: string; answer: string; citations: unknown[] }) => void;
}

export function FavouritesSidebar({ refreshKey, onSelect }: Props) {
  const [favourites, setFavourites] = useState<FavouriteSummary[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // There's no room for a permanent sidebar on a phone, but this is exactly the
  // "on site, checking a past answer on my phone" use case the sidebar exists for —
  // so on mobile it becomes a bottom-bar button that opens the same list full-screen,
  // rather than just disappearing below the md breakpoint.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/favourites")
      .then((res) => res.json())
      .then((json) => setFavourites(json.favourites ?? []));
  }, [refreshKey]);

  async function handleSelect(id: string) {
    setLoadingId(id);
    const res = await fetch(`/api/favourites/${id}`);
    const json = await res.json();
    setLoadingId(null);
    if (res.ok) {
      onSelect(json);
      setMobileOpen(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setFavourites((prev) => prev.filter((f) => f.id !== id));
    await fetch(`/api/favourites/${id}`, { method: "DELETE" });
  }

  const list =
    favourites.length === 0 ? (
      <p className="text-xs text-offwhite/40">
        Favourite an answer to save it here for quick access later.
      </p>
    ) : (
      <ul className="flex flex-col gap-1">
        {favourites.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => handleSelect(f.id)}
              disabled={loadingId === f.id}
              className="group flex w-full items-start justify-between gap-1 rounded px-2 py-1.5 text-left text-sm text-offwhite/80 hover:bg-cyan/10 hover:text-cyan disabled:opacity-50"
            >
              <span>{loadingId === f.id ? "Loading…" : f.title}</span>
              <span
                onClick={(e) => handleDelete(e, f.id)}
                className="shrink-0 text-offwhite/30 opacity-0 hover:text-amber group-hover:opacity-100"
                aria-label={`Remove ${f.title}`}
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
      <aside className="hidden w-56 shrink-0 flex-col gap-3 border-r border-cyan/20 px-4 py-10 md:flex">
        <h2 className="font-heading text-sm font-medium text-offwhite/60">Favourites</h2>
        {list}
      </aside>

      {/* Mobile: left half of a fixed bottom bar (HistorySidebar renders the right
          half) — see page.tsx's bottom padding on the main column that reserves
          space for it. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-0 left-0 z-40 flex w-1/2 items-center justify-center gap-1.5 border-r border-t border-cyan/20 bg-navy py-3 font-mono text-xs text-cyan md:hidden"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        ☆ Favourites
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
              <h2 className="font-heading text-sm font-medium text-offwhite/60">Favourites</h2>
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
