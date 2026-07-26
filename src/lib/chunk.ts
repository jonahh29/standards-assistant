export interface Chunk {
  content: string;
  pageNumber: number;
  clauseLabel: string | null;
}

const TARGET_CHUNK_SIZE = 800;
const MAX_CLAUSE_CHUNK_SIZE = 3000;

// A bare numbered clause header at the start of a line, e.g. "9.5.4 Heading text".
// Distinct from "Figure X.Y:"/"Table X.Y:" captions, which start with a word, not a digit.
const CLAUSE_HEADER_PATTERN = /^\s*(\d{1,2}(?:\.\d{1,3}){1,4}[a-z]?)\s+(?=\S)/;
// Table-of-contents lines look identical to headers ("9.5.4 Heading .......... 245") —
// the run of dot leaders is the tell; skip anything matching this so a TOC page (or a
// section's own mini-TOC) doesn't get mistaken for the real clause body.
const DOT_LEADER_PATTERN = /\.{4,}/;

function matchClauseHeader(line: string): string | null {
  if (DOT_LEADER_PATTERN.test(line)) return null;
  const match = line.match(CLAUSE_HEADER_PATTERN);
  return match ? match[1] : null;
}

function chunkFallback(pageText: string, pageNumber: number): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = pageText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  let buffer = "";
  const flush = () => {
    if (!buffer.trim()) return;
    chunks.push({ content: buffer.trim(), pageNumber, clauseLabel: null });
    buffer = "";
  };

  for (const paragraph of paragraphs) {
    if (buffer.length + paragraph.length > TARGET_CHUNK_SIZE && buffer) flush();
    buffer += (buffer ? "\n\n" : "") + paragraph;
  }
  flush();

  return chunks;
}

/**
 * Chunks the whole document by clause boundaries rather than per-page: a numbered
 * clause header starts a new chunk that keeps accumulating (across page breaks) until
 * the next header, so a clause is retrieved as one coherent unit instead of an
 * arbitrary character-count fragment. Content before the first header anywhere in the
 * document (front matter/TOC) falls back to simple per-page paragraph chunking.
 */
export function chunkDocument(pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let sawFirstHeader = false;
  let currentLabel: string | null = null;
  let currentPage = 1;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) chunks.push({ content, pageNumber: currentPage, clauseLabel: currentLabel });
    buffer = [];
  };

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageNumber = pageIndex + 1;
    const lines = pages[pageIndex].split("\n");

    if (!sawFirstHeader && !lines.some((line) => matchClauseHeader(line) !== null)) {
      chunks.push(...chunkFallback(pages[pageIndex], pageNumber));
      continue;
    }

    for (const line of lines) {
      const label = matchClauseHeader(line);
      if (label) {
        flush();
        sawFirstHeader = true;
        currentLabel = label;
        currentPage = pageNumber;
      }
      buffer.push(line);

      if (buffer.join("\n").length > MAX_CLAUSE_CHUNK_SIZE) flush();
    }
  }
  flush();

  return chunks;
}
