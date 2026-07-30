export interface Figure {
  url: string;
  label: string | null;
  storagePath?: string;
}

export interface Citation {
  documentTitle: string;
  pageNumber: number | null;
  pageEnd: number | null;
  clauseLabel: string | null;
  content: string;
  figures: Figure[];
}

export interface CitationMatch {
  kind: "figure";
  text: string;
  citation: Citation;
  figure: Figure;
}

// Bare "Figure 9.5.4" / "Table 5.6.3" mentions in running prose. Clause/page text is
// no longer auto-highlighted — it depended on Claude reliably reproducing an exact
// "(Document title, clause X)" marker on every mention, which proved too fragile
// under a conversational writing style. Figures are still detected here since the
// figure's own filename/label match doesn't depend on Claude's phrasing at all.
const FIGURE_MENTION_PATTERN = /\b((?:Figure|Table)\s+\d+(?:\.\d+)*[a-z]?)\b/g;

function findFigureForMention(
  citations: Citation[],
  mention: string
): { citation: Citation; figure: Figure } | undefined {
  for (const citation of citations) {
    for (const figure of citation.figures) {
      if (figure.label?.includes(mention)) return { citation, figure };
    }
  }
  return undefined;
}

interface RawMatch {
  index: number;
  length: number;
  match: CitationMatch;
}

/** Splits answer text into plain strings interleaved with recognized figure/table
 * mentions, cross-referenced against the retrieved citations. Anything not found in
 * `citations` is left as plain text. */
export function splitTextWithCitations(
  text: string,
  citations: Citation[]
): (string | CitationMatch)[] {
  if (citations.length === 0) return [text];

  const rawMatches: RawMatch[] = [];

  for (const m of text.matchAll(FIGURE_MENTION_PATTERN)) {
    const mention = m[1];
    const found = findFigureForMention(citations, mention);
    if (found) {
      rawMatches.push({
        index: m.index!,
        length: mention.length,
        match: {
          kind: "figure",
          text: mention,
          citation: found.citation,
          figure: found.figure,
        },
      });
    }
  }

  if (rawMatches.length === 0) return [text];

  rawMatches.sort((a, b) => a.index - b.index);
  const filtered: RawMatch[] = [];
  let cursor = 0;
  for (const rm of rawMatches) {
    if (rm.index < cursor) continue;
    filtered.push(rm);
    cursor = rm.index + rm.length;
  }

  const parts: (string | CitationMatch)[] = [];
  let lastIndex = 0;
  for (const rm of filtered) {
    if (rm.index > lastIndex) parts.push(text.slice(lastIndex, rm.index));
    parts.push(rm.match);
    lastIndex = rm.index + rm.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return parts;
}
