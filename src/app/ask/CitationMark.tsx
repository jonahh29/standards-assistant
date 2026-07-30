"use client";

import { useState } from "react";
import type { CitationMatch } from "./citationMatching";
import { CitationPopover } from "./CitationPopover";

export function CitationMark({ match }: { match: CitationMatch }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <span
        className="cursor-pointer border-b border-dashed border-cyan text-cyan"
        onClick={() => setOpen(true)}
      >
        {match.text}
      </span>
      {open && (
        <CitationPopover citation={match.citation} figure={match.figure} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}
