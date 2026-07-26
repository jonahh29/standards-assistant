import sharp from "sharp";
import { extractImages, getDocumentProxy } from "unpdf";

type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

export interface ExtractedFigure {
  pageNumber: number;
  label: string | null;
  width: number;
  height: number;
  png: Buffer;
}

const MIN_DIMENSION = 100;
const LABEL_PATTERN = /\b(Figure\s+\d+(?:\.\d+)*|Table\s+\d+(?:\.\d+)*)/i;

function detectLabel(pageText: string): string | null {
  const match = pageText.match(LABEL_PATTERN);
  return match ? match[1] : null;
}

/** Extracts embedded images (above a small size threshold) from every page, converting each to a PNG buffer. */
export async function extractFigures(
  pdf: PDFDocumentProxy,
  pages: string[]
): Promise<ExtractedFigure[]> {
  const figures: ExtractedFigure[] = [];

  for (let pageNumber = 1; pageNumber <= pages.length; pageNumber++) {
    const images = await extractImages(pdf, pageNumber);
    const label = detectLabel(pages[pageNumber - 1] ?? "");

    for (const image of images) {
      if (image.width < MIN_DIMENSION || image.height < MIN_DIMENSION) continue;

      const png = await sharp(image.data, {
        raw: { width: image.width, height: image.height, channels: image.channels },
      })
        .png()
        .toBuffer();

      figures.push({
        pageNumber,
        label,
        width: image.width,
        height: image.height,
        png,
      });
    }
  }

  return figures;
}
