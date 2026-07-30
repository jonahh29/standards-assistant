"use client";

import { useState } from "react";
import type { Citation, Figure } from "./citationMatching";

export function CitationPopover({
  citation,
  figure,
  onClose,
}: {
  citation: Citation;
  figure?: Figure;
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const figureToShow = figure ?? citation.figures[0];

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
          {citation.documentTitle}
          {citation.clauseLabel
            ? ` — clause ${citation.clauseLabel}`
            : citation.pageNumber
              ? ` — p.${citation.pageNumber}`
              : ""}
        </div>
        {figureToShow && (
          <>
            <div
              className={
                zoomed
                  ? "max-h-[65vh] overflow-auto rounded border border-cyan/20"
                  : "max-h-[65vh] overflow-hidden rounded border border-cyan/20"
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={figureToShow.url}
                alt={figureToShow.label ?? ""}
                onClick={() => setZoomed((z) => !z)}
                className={
                  zoomed
                    ? "w-auto max-w-none cursor-zoom-out"
                    : "h-auto max-h-[65vh] w-full cursor-zoom-in object-contain"
                }
              />
            </div>
            <span className="font-mono text-xs text-offwhite/40">
              {zoomed ? "Click image to zoom out" : "Click image to zoom in"}
            </span>
          </>
        )}
        {citation.content && (
          <div className="overflow-y-auto text-base leading-relaxed text-offwhite/90">
            {citation.content}
          </div>
        )}
      </div>
    </div>
  );
}
