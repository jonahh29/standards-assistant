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

export type CitationMatch =
  | { kind: "clause" | "page"; text: string; citation: Citation }
  | { kind: "figure"; text: string; citation: Citation; figure: Figure };

// Matches "(Document Title, clause 9.5.4)" or "(Document Title, p.212)", tolerating
// an occasional sub-reference like "9.2.2(2)" that Claude sometimes appends.
const PAREN_CITATION_PATTERN =
  /\(([^,()]+),\s*(?:clause\s+([\d.]+[a-z]?(?:\(\w+\))*)|p\.\s*(\d+))\)/g;
// Bare "Figure 9.5.4" / "Table 5.6.3" mentions in running prose.
const FIGURE_MENTION_PATTERN = /\b((?:Figure|Table)\s+\d+(?:\.\d+)*[a-z]?)\b/g;

function docTitleMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// A clause number can appear in more than one retrieved chunk — e.g. a bare heading
// line from a contents/summary listing alongside the chunk with the clause's actual
// body text. Prefer whichever candidate has the most content, so a popover never
// shows a near-empty stub when the real text is also available.
function richest(candidates: Citation[]): Citation | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, c) => (c.content.length > best.content.length ? c : best));
}

function findClauseCitation(
  citations: Citation[],
  docTitle: string,
  clauseRaw: string
): Citation | undefined {
  const clause = clauseRaw.replace(/(\(\w+\))+$/, "");
  return richest(
    citations.filter(
      (c) => c.clauseLabel === clause && docTitleMatches(c.documentTitle, docTitle)
    )
  );
}

function findPageCitation(
  citations: Citation[],
  docTitle: string,
  page: string
): Citation | undefined {
  return richest(
    citations.filter(
      (c) =>
        !c.clauseLabel &&
        c.pageNumber === Number(page) &&
        docTitleMatches(c.documentTitle, docTitle)
    )
  );
}

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

/** Splits answer text into plain strings interleaved with recognized citation/figure mentions, cross-referenced against the retrieved citations. Anything not found in `citations` is left as plain text. */
export function splitTextWithCitations(
  text: string,
  citations: Citation[]
): (string | CitationMatch)[] {
  if (citations.length === 0) return [text];

  const rawMatches: RawMatch[] = [];

  for (const m of text.matchAll(PAREN_CITATION_PATTERN)) {
    const [full, docTitle, clauseRaw, page] = m;
    const citation = clauseRaw
      ? findClauseCitation(citations, docTitle, clauseRaw)
      : findPageCitation(citations, docTitle, page);
    if (citation) {
      rawMatches.push({
        index: m.index!,
        length: full.length,
        match: { kind: clauseRaw ? "clause" : "page", text: full, citation },
      });
    }
  }

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
