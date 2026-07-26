export interface Chunk {
  content: string;
  pageNumber: number;
  clauseLabel: string | null;
}

const TARGET_CHUNK_SIZE = 800;
const CLAUSE_PATTERN =
  /^(\d{1,2}(?:\.\d{1,3}){0,3}\b|(?:table|figure|section|appendix)\s+\d+[a-z]?)/i;

function detectClauseLabel(text: string): string | null {
  const match = text.trim().match(CLAUSE_PATTERN);
  return match ? match[1] : null;
}

/** Splits per-page text into ~TARGET_CHUNK_SIZE-character chunks, paragraph-aware, tagged with page number and (when detectable) a clause/table/section label. */
export function chunkPages(pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];

  pages.forEach((pageText, index) => {
    const pageNumber = index + 1;
    const paragraphs = pageText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buffer = "";

    const flush = () => {
      if (!buffer.trim()) return;
      chunks.push({
        content: buffer.trim(),
        pageNumber,
        clauseLabel: detectClauseLabel(buffer),
      });
      buffer = "";
    };

    for (const paragraph of paragraphs) {
      if (buffer.length + paragraph.length > TARGET_CHUNK_SIZE && buffer) {
        flush();
      }
      buffer += (buffer ? "\n\n" : "") + paragraph;
    }
    flush();
  });

  return chunks;
}
