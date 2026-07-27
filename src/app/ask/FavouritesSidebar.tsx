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
    if (res.ok) onSelect(json);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setFavourites((prev) => prev.filter((f) => f.id !== id));
    await fetch(`/api/favourites/${id}`, { method: "DELETE" });
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-3 border-r border-cyan/20 px-4 py-10 md:flex">
      <h2 className="font-heading text-sm font-medium text-offwhite/60">Favourites</h2>
      {favourites.length === 0 ? (
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
      )}
    </aside>
  );
}
