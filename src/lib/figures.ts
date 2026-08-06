import sharp from "sharp";
import {
  definePDFJSModule,
  extractImages,
  getDocumentProxy,
  renderPageAsImage,
} from "unpdf";

export type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

export interface ExtractedFigure {
  pageNumber: number;
  label: string | null;
  width: number;
  height: number;
  png: Buffer;
}

export interface PageLabels {
  page: number;
  labels: string[];
}

const MIN_DIMENSION = 100;
const RENDER_SCALE = 1.5;
// Matches caption lines like "Figure 9.2.2a:", "Figure 9.2.5g/h:", "Table 5.6.3:" —
// and also a title with no colon at all, e.g. "Figure 2.1 Measurement of clear
// opening width" (some documents just don't use one). No "i" flag: the [A-Z]
// lookahead in the no-colon branch must stay case-sensitive, or it matches any
// letter and accepts lowercase sentence continuations as if they were captions.
// [a-z]{0,2} (not just one letter) captures a double-letter suffix like "13.3.2aa"
// as part of the actual label — it must be inside the capture group, not left for
// the trailing \S{0,1} to swallow, or the stored label gets silently truncated to
// "13.3.2a". \S{0,1} is only for a stray non-letter artifact right after the number
// (a PDF font-encoding glitch — a Private Use Area glyph — confirmed on a real
// page). The negative lookahead excludes "summary of changes" style rows that are
// structurally caption-like but aren't real captions, e.g. "Table 2.2.3b Amended to
// reflect revised wind regions." or a duplicated self-reference like "Figure 2
// Figure 2 has been updated." — and [ \t] (not \s) keeps the whitespace check
// same-line only, so it can't bleed into an unrelated following line.
const LABEL_PATTERN =
  /^\s*((?:Figure|Table)\s+\d+(?:\.\d+)*[a-z]{0,2}(?:\/[a-z])?)\S{0,1}(?:[ \t]*:|[ \t]+(?!(?:Amended|Added|Deleted|Updated|Revised|Removed|Changed|Renumbered|Has|Figure|Table)\b)(?=[A-Z]))/gm;
// A bare numbered clause header at the start of a line — mirrors chunk.ts's pattern,
// used here only to detect where a table's continuation onto the next page ends.
const CLAUSE_HEADER_PATTERN = /^\s*\d{1,2}(?:\.\d{1,3}){1,4}[a-z]?\s+\S/m;
const DOT_LEADER_PATTERN = /\.{4,}/;

function hasNewClauseHeader(pageText: string): boolean {
  return pageText
    .split("\n")
    .some((line) => !DOT_LEADER_PATTERN.test(line) && CLAUSE_HEADER_PATTERN.test(line));
}

let pdfjsModuleReady: Promise<void> | null = null;

/** Switches unpdf to the official (Node-compatible "legacy") PDF.js build, required for page rendering. Must run before any PDF is opened. */
export function ensurePdfjsModule() {
  if (!pdfjsModuleReady) {
    pdfjsModuleReady = definePDFJSModule(
      () => import("pdfjs-dist/legacy/build/pdf.mjs")
    );
  }
  return pdfjsModuleReady;
}

// Absence of a new clause header isn't a reliable enough stop condition on its own —
// some documents go many pages without anything matching our clause-number pattern
// (e.g. NCC Volume 2's non-numbered sections), which let one false match run away
// across 190+ pages in testing. Capping the chain bounds any misfire to a couple of
// extra page renders instead of a large chunk of the document.
const MAX_CONTINUATION_PAGES = 2;

/** Pure text-based caption detection — no rendering. Returns pages that have at least
 * one "Figure X.Y:" / "Table X.Y:" caption, plus up to MAX_CONTINUATION_PAGES pages
 * immediately after a Table caption that look like a continuation of that same table
 * (no new caption and no new clause header on them) — tables with many rows commonly
 * spill onto a second page, unlike diagrams, which is why only "Table" captions (not
 * "Figure") get this check. */
export function detectPageLabels(pages: string[]): PageLabels[] {
  const result: PageLabels[] = [];
  let continuingTableLabels: string[] | null = null;
  let continuationCount = 0;

  for (let pageNumber = 1; pageNumber <= pages.length; pageNumber++) {
    const pageText = pages[pageNumber - 1] ?? "";
    const labels = [...pageText.matchAll(LABEL_PATTERN)].map((m) => m[1]);

    if (labels.length > 0) {
      result.push({ page: pageNumber, labels });
      const tableLabels = labels.filter((l) => l.toLowerCase().startsWith("table"));
      continuingTableLabels = tableLabels.length > 0 ? tableLabels : null;
      continuationCount = 0;
      continue;
    }

    if (
      continuingTableLabels &&
      continuationCount < MAX_CONTINUATION_PAGES &&
      !hasNewClauseHeader(pageText)
    ) {
      result.push({ page: pageNumber, labels: continuingTableLabels });
      continuationCount++;
      continue;
    }

    continuingTableLabels = null;
    continuationCount = 0;
  }

  return result;
}

/** Pulls embedded raster images off a single (uncaptioned) page — cheap, no page rendering. */
export async function extractRasterImages(
  pdf: PDFDocumentProxy,
  pageNumber: number
): Promise<ExtractedFigure[]> {
  const figures: ExtractedFigure[] = [];
  const images = await extractImages(pdf, pageNumber);

  for (const image of images) {
    if (image.width < MIN_DIMENSION || image.height < MIN_DIMENSION) continue;

    const png = await sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: image.channels },
    })
      .png()
      .toBuffer();

    figures.push({ pageNumber, label: null, width: image.width, height: image.height, png });
  }

  return figures;
}

/** Renders a whole captioned page to a PNG (captures vector-drawn diagrams, which is how most technical Standards figures are actually drawn). */
export async function renderFigurePage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  labels: string[]
): Promise<ExtractedFigure> {
  const rendered = await renderPageAsImage(pdf, pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: RENDER_SCALE,
  });
  const png = Buffer.from(rendered as ArrayBuffer);
  const metadata = await sharp(png).metadata();

  return {
    pageNumber,
    label: labels.join(", "),
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    png,
  };
}
