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

// Bare "Figure 9.5.4" / "Table 5.6.3" mentions in running prose, including a list that
// only states the keyword once — "Table 6.3.9a, 6.3.9b and 6.3.9c" — rather than
// repeating it before every number. Clause/page text is no longer auto-highlighted —
// it depended on Claude reliably reproducing an exact "(Document title, clause X)"
// marker on every mention, which proved too fragile under a conversational writing
// style. Figures are still detected here since the figure's own filename/label match
// doesn't depend on Claude's phrasing at all.
const FIGURE_GROUP_PATTERN =
  /\b(Figures?|Tables?)\s+(\d+(?:\.\d+)*[a-z]?(?:\s*(?:,|and)\s*\d+(?:\.\d+)*[a-z]?)*)/g;
const TOKEN_PATTERN = /\d+(?:\.\d+)*[a-z]?/g;

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

  for (const m of text.matchAll(FIGURE_GROUP_PATTERN)) {
    const keyword = m[1];
    const singular = keyword.replace(/s$/, "");
    const listText = m[2];
    const listStart = m.index! + (m[0].length - listText.length);

    [...listText.matchAll(TOKEN_PATTERN)].forEach((tok, i) => {
      const token = tok[0];
      const found = findFigureForMention(citations, `${singular} ${token}`);
      if (!found) return;

      if (i === 0) {
        // First item keeps the keyword highlighted too (e.g. "Table 6.3.9a"),
        // matching how a lone mention has always been highlighted.
        rawMatches.push({
          index: m.index!,
          length: keyword.length + 1 + token.length,
          match: {
            kind: "figure",
            text: `${keyword} ${token}`,
            citation: found.citation,
            figure: found.figure,
          },
        });
      } else {
        // A later item in a list ("...6.3.9b and 6.3.9c") doesn't repeat the keyword
        // in the source text, so only the bare number itself can be highlighted.
        rawMatches.push({
          index: listStart + tok.index!,
          length: token.length,
          match: { kind: "figure", text: token, citation: found.citation, figure: found.figure },
        });
      }
    });
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
