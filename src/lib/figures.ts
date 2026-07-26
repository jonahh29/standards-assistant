import sharp from "sharp";
import {
  definePDFJSModule,
  extractImages,
  getDocumentProxy,
  renderPageAsImage,
} from "unpdf";

type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

export interface ExtractedFigure {
  pageNumber: number;
  label: string | null;
  width: number;
  height: number;
  png: Buffer;
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

function detectLabels(pageText: string): string[] {
  return [...pageText.matchAll(LABEL_PATTERN)].map((m) => m[1]);
}

/**
 * Extracts figures from every page: pages whose text mentions a "Figure X.Y" or
 * "Table X.Y" are rendered whole (captures vector-drawn diagrams, which is how most
 * technical Standards diagrams are actually drawn — not embedded photos). Pages
 * without such a caption still get any embedded raster images pulled out directly
 * (covers scanned/photo content).
 */
export async function extractFigures(
  pdf: PDFDocumentProxy,
  pages: string[]
): Promise<ExtractedFigure[]> {
  const figures: ExtractedFigure[] = [];

  for (let pageNumber = 1; pageNumber <= pages.length; pageNumber++) {
    const labels = detectLabels(pages[pageNumber - 1] ?? "");

    if (labels.length > 0) {
      const rendered = await renderPageAsImage(pdf, pageNumber, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: RENDER_SCALE,
      });
      const png = Buffer.from(rendered as ArrayBuffer);
      const metadata = await sharp(png).metadata();

      figures.push({
        pageNumber,
        label: labels.join(", "),
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        png,
      });
      continue;
    }

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
  }

  return figures;
}
