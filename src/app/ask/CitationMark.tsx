"use client";

import { useState } from "react";
import type { CitationMatch } from "./citationMatching";

export function CitationMark({ match }: { match: CitationMatch }) {
  const [hovered, setHovered] = useState(false);
  const figureToShow = match.kind === "figure" ? match.figure : match.citation.figures[0];

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="cursor-help border-b border-dashed border-cyan text-cyan">
        {match.text}
      </span>
      {hovered && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded border border-cyan/30 bg-navy p-3 text-left normal-case shadow-lg">
          <div className="mb-1 font-mono text-xs text-offwhite/50">
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
              className="mb-2 max-h-40 w-full rounded object-contain"
            />
          )}
          {match.citation.content && (
            <div className="line-clamp-6 text-xs leading-relaxed text-offwhite/80">
              {match.citation.content}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
