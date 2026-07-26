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
// Matches caption lines like "Figure 9.2.2a:", "Figure 9.2.5g/h:", "Table 5.6.3:"
const LABEL_PATTERN = /^\s*((?:Figure|Table)\s+\d+(?:\.\d+)*[a-z]?(?:\/[a-z])?)\s*:/gim;

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

/** Pure text-based caption detection — no rendering. Returns only pages that have at least one "Figure X.Y:" / "Table X.Y:" caption. */
export function detectPageLabels(pages: string[]): PageLabels[] {
  const result: PageLabels[] = [];
  for (let pageNumber = 1; pageNumber <= pages.length; pageNumber++) {
    const labels = [...(pages[pageNumber - 1] ?? "").matchAll(LABEL_PATTERN)].map(
      (m) => m[1]
    );
    if (labels.length > 0) result.push({ page: pageNumber, labels });
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
