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
// A lettered range like "Figures 6.2a–6.2g" or the abbreviated "Figures 6.2a–g" —
// expanded into one highlighted mention per letter rather than leaving everything
// after the dash as plain text, since none of those individual figures are
// otherwise ever named on their own in the prose.
const RANGE_PATTERN = /\b(Figures?|Tables?)\s+(\d+(?:\.\d+)*)([a-z])\s*[-–—]\s*(?:\2)?([a-z])\b/g;
// Catches a bare sub-figure reference with no "Figure"/"Table" keyword nearby at
// all — e.g. "...shown in Figures 6.2a or 6.2b for bath walls, 6.2c or 6.2d for
// shower walls..." only "6.2a" gets a keyword; everything after is bare numbers
// scattered through unrelated descriptive text between them, not a clean list or
// range either pattern above can parse. A dotted number with a lettered suffix
// (e.g. "6.2a", "9.2.5b") is essentially never anything other than a figure/table
// sub-reference in this corpus — clause numbers here don't take a directly-attached
// trailing letter — and it only ever renders as a link if it actually resolves
// against a real figure, so an unrelated coincidental match (a measurement like
// "3.5m") is harmless unless a figure with that exact label genuinely exists too.
const BARE_LETTERED_PATTERN = /\b\d+(?:\.\d+)+[a-z]{1,2}\b/g;

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
  // Every raw match expands to one or more rendered parts — a single mention is
  // just [CitationMatch], a comma list contributes one entry per raw match (each
  // its own RawMatch), and a lettered range expands to many parts from one match.
  parts: (string | CitationMatch)[];
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

  for (const m of text.matchAll(RANGE_PATTERN)) {
    const keyword = m[1];
    const singular = keyword.replace(/s$/, "");
    const base = m[2];
    const startLetter = m[3];
    const endLetter = m[4];
    if (startLetter >= endLetter) continue;

    const letterParts: (string | CitationMatch)[] = [];
    for (let code = startLetter.charCodeAt(0); code <= endLetter.charCodeAt(0); code++) {
      const letter = String.fromCharCode(code);
      const token = `${base}${letter}`;
      const found = findFigureForMention(citations, `${singular} ${token}`);
      if (letterParts.length > 0) {
        letterParts.push(code === endLetter.charCodeAt(0) ? " and " : ", ");
      }
      letterParts.push(
        found
          ? { kind: "figure" as const, text: `${singular} ${token}`, citation: found.citation, figure: found.figure }
          : `${singular} ${token}`
      );
    }

    // Only expand if at least one letter actually resolved to a real figure —
    // otherwise leave the original range text untouched as plain prose.
    if (letterParts.some((p) => typeof p !== "string")) {
      rawMatches.push({ index: m.index!, length: m[0].length, parts: letterParts });
    }
  }

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
          parts: [
            { kind: "figure", text: `${keyword} ${token}`, citation: found.citation, figure: found.figure },
          ],
        });
      } else {
        // A later item in a list ("...6.3.9b and 6.3.9c") doesn't repeat the keyword
        // in the source text, so only the bare number itself can be highlighted.
        rawMatches.push({
          index: listStart + tok.index!,
          length: token.length,
          parts: [{ kind: "figure", text: token, citation: found.citation, figure: found.figure }],
        });
      }
    });
  }

  for (const m of text.matchAll(BARE_LETTERED_PATTERN)) {
    const token = m[0];
    const found = findFigureForMention(citations, token);
    if (!found) continue;
    rawMatches.push({
      index: m.index!,
      length: token.length,
      parts: [{ kind: "figure", text: token, citation: found.citation, figure: found.figure }],
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
    parts.push(...rm.parts);
    lastIndex = rm.index + rm.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return parts;
}
