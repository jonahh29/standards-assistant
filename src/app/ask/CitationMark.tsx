"use client";

import { useState } from "react";
import type { CitationMatch } from "./citationMatching";

export function CitationMark({ match }: { match: CitationMatch }) {
  const [open, setOpen] = useState(false);
  const figureToShow = match.kind === "figure" ? match.figure : match.citation.figures[0];

  return (
    <span className="relative inline-block">
      <span
        className="cursor-pointer border-b border-dashed border-cyan text-cyan"
        onClick={() => setOpen(true)}
      >
        {match.text}
      </span>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/90 p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-3 overflow-hidden rounded-lg border border-cyan/30 bg-navy p-6 text-left normal-case shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-sm text-offwhite/50">
              {match.citation.documentTitle}
              {match.citation.clauseLabel
                ? ` — clause ${match.citation.clauseLabel}`
                : match.citation.pageNumber
                  ? ` — p.${match.citation.pageNumber}`
                  : ""}
            </div>
            {figureToShow && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={figureToShow.url}
                alt={figureToShow.label ?? ""}
                className="max-h-[65vh] w-full rounded border border-cyan/20 object-contain"
              />
            )}
            {match.citation.content && (
              <div className="overflow-y-auto text-base leading-relaxed text-offwhite/90">
                {match.citation.content}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
