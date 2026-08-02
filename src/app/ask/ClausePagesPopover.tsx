"use client";

import { useEffect, useState } from "react";

interface Page {
  pageNumber: number;
  url: string;
}

interface Props {
  documentId: string;
  documentTitle: string;
  clauseLabel: string;
  pageStart: number;
  pageEnd: number;
  onClose: () => void;
}

export function ClausePagesPopover({
  documentId,
  documentTitle,
  clauseLabel,
  pageStart,
  pageEnd,
  onClose,
}: Props) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setError("");

    fetch(`/api/documents/${documentId}/pages?start=${pageStart}&end=${pageEnd}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setPages(json.pages ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Something went wrong loading the page images.");
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, pageStart, pageEnd]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/90 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-3 overflow-hidden rounded-lg border border-cyan/30 bg-navy p-6 text-left normal-case shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-sm text-offwhite/50">
          {documentTitle} — clause {clauseLabel} (
          {pageStart === pageEnd ? `p.${pageStart}` : `pp.${pageStart}–${pageEnd}`})
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto">
          {error && <p className="font-mono text-sm text-amber">Error — {error}</p>}
          {!error && !pages && (
            <p className="font-mono text-sm text-offwhite/50">Loading page images…</p>
          )}
          {pages?.length === 0 && (
            <p className="font-mono text-sm text-offwhite/50">No page images available.</p>
          )}
          {pages?.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.pageNumber}
              src={p.url}
              alt={`Page ${p.pageNumber}`}
              className="w-full rounded border border-cyan/20"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
