import { getDocumentProxy } from "unpdf";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/supabase-session";
import { ensurePdfjsModule, renderFigurePage } from "@/lib/figures";
import { embedTexts } from "@/lib/voyage";
import {
  extractDrawingItems,
  buildComplianceReport,
  type DrawingImage,
  type DrawingCheckItem,
  type RetrievedChunk,
} from "@/lib/anthropic";
import { buildCitations, type MatchRow } from "@/lib/citationBuilder";

export const runtime = "nodejs";
export const maxDuration = 120;

// A drawing set's most compliance-relevant sheets (site plan, floor plan,
// elevations) comfortably fit well under this — keeps one request bounded, same
// reasoning as the MAX_PAGES cap on the page-image endpoint.
const MAX_PAGES = 10;
const CHUNKS_PER_ITEM = 3;
const MAX_DOCUMENTS_PER_ITEM = 3;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const { storagePath, filename, documentIds: filterDocumentIds } = await request.json();

  if (!storagePath || typeof storagePath !== "string" || !filename || typeof filename !== "string") {
    return Response.json({ error: "A file is required." }, { status: 400 });
  }

  const filterIds =
    Array.isArray(filterDocumentIds) && filterDocumentIds.length > 0 ? filterDocumentIds : null;

  const supabase = getSupabaseServerClient();

  try {
    return await runComplianceCheck(supabase, storagePath, filename, filterIds);
  } catch (err) {
    // An uncaught error here would otherwise return Next's default HTML error page,
    // which breaks the client's res.json() parse ("Unexpected end of JSON input")
    // instead of showing the actual problem.
    console.error("Compliance check failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Something went wrong checking this drawing." },
      { status: 500 }
    );
  }
}

async function runComplianceCheck(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  storagePath: string,
  filename: string,
  filterIds: string[] | null
): Promise<Response> {
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("compliance-drawings")
    .download(storagePath);

  if (downloadError || !fileBlob) {
    return Response.json(
      { error: downloadError?.message ?? "Could not load the uploaded file." },
      { status: 500 }
    );
  }

  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const images: DrawingImage[] = [];

  if (isPdf) {
    await ensurePdfjsModule();
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);

    for (let p = 1; p <= pageCount; p++) {
      const rendered = await renderFigurePage(pdf, p, []);
      images.push({ data: rendered.png, mediaType: "image/png" });
    }
  } else {
    const mediaType = filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    images.push({ data: buffer, mediaType });
  }

  if (images.length === 0) {
    return Response.json({ error: "Could not read any pages from that file." }, { status: 400 });
  }

  const itemDescriptions = await extractDrawingItems(images);

  if (itemDescriptions.length === 0) {
    return Response.json({
      report:
        "I couldn't identify any clearly checkable, annotated elements on this drawing — try a page with visible dimensions or labels (a dimensioned floor plan, site plan, or elevation works best).",
      citations: [],
      offeredClause: null,
    });
  }

  const embeddings = await embedTexts(itemDescriptions);

  const perItemResults = await Promise.all(
    itemDescriptions.map(async (description, i) => {
      const { data: vectorMatches } = await supabase.rpc("match_document_chunks_diverse", {
        query_embedding: embeddings[i],
        chunks_per_document: CHUNKS_PER_ITEM,
        max_documents: MAX_DOCUMENTS_PER_ITEM,
        filter_document_ids: filterIds,
      });
      return { description, matches: (vectorMatches ?? []) as MatchRow[] };
    })
  );

  const seen = new Set<string>();
  const allMatches: MatchRow[] = [];
  for (const { matches } of perItemResults) {
    for (const m of matches) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      allMatches.push(m);
    }
  }

  if (allMatches.length === 0) {
    return Response.json({
      report:
        "No documents have been uploaded yet (or none matched the items found on this drawing), so there's nothing to check it against.",
      citations: [],
      offeredClause: null,
    });
  }

  const documentIds = [...new Set(allMatches.map((m) => m.document_id))];
  const { data: documents } = await supabase.from("documents").select("id, title").in("id", documentIds);

  const titleById = new Map((documents ?? []).map((d) => [d.id, d.title as string]));
  const docIdByTitle = new Map((documents ?? []).map((d) => [d.title as string, d.id as string]));

  const reportItems: DrawingCheckItem[] = perItemResults.map(({ description, matches }) => ({
    description,
    chunks: matches.map(
      (m): RetrievedChunk => ({
        documentTitle: titleById.get(m.document_id) ?? "Unknown document",
        pageNumber: m.page_number,
        clauseLabel: m.clause_label,
        content: m.content,
      })
    ),
  }));

  const report = await buildComplianceReport(reportItems);

  const { citations, offeredClause } = await buildCitations({
    matches: allMatches,
    answer: report,
    documentIds,
    titleById,
    docIdByTitle,
  });

  return Response.json({ report, citations, offeredClause });
}
