import { getSupabaseServerClient } from "@/lib/supabase-server";
import { embedTexts } from "@/lib/voyage";
import { askWithCitations, type RetrievedChunk } from "@/lib/anthropic";
import { buildCitations, type MatchRow } from "@/lib/citationBuilder";

export const runtime = "nodejs";
export const maxDuration = 120;

const CHUNKS_PER_DOCUMENT = 20;
const MAX_DOCUMENTS = 6;
const CLAUSE_PATTERN = /\b\d{1,2}(?:\.\d{1,3}){1,4}[a-z]?\b/g;

export async function POST(request: Request) {
  const { question, documentIds: filterDocumentIds } = await request.json();

  if (!question || typeof question !== "string") {
    return Response.json({ error: "A question is required." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const filterIds =
    Array.isArray(filterDocumentIds) && filterDocumentIds.length > 0
      ? filterDocumentIds
      : null;

  const [questionEmbedding] = await embedTexts([question]);

  const { data: vectorMatches, error: matchError } = await supabase.rpc(
    "match_document_chunks_diverse",
    {
      query_embedding: questionEmbedding,
      chunks_per_document: CHUNKS_PER_DOCUMENT,
      max_documents: MAX_DOCUMENTS,
      filter_document_ids: filterIds,
    }
  );

  if (matchError) {
    return Response.json({ error: matchError.message }, { status: 500 });
  }

  // Guarantee any clause number the user names explicitly is included, even if it
  // didn't rank in the top vector matches.
  const clauseNumbers = [...new Set(question.match(CLAUSE_PATTERN) ?? [])] as string[];
  let exactMatches: MatchRow[] = [];
  if (clauseNumbers.length > 0) {
    let query = supabase
      .from("document_chunks")
      .select("id, document_id, content, page_number, page_end, clause_label")
      .or(clauseNumbers.map((c) => `clause_label.ilike.${c}%`).join(","));
    if (filterIds) query = query.in("document_id", filterIds);
    const { data } = await query;
    exactMatches = data ?? [];
  }

  const seen = new Set<string>();
  const matches: MatchRow[] = [];
  for (const row of [...(vectorMatches ?? []), ...exactMatches]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    matches.push(row);
  }

  if (matches.length === 0) {
    return Response.json({
      answer: "No documents have been uploaded yet, so there's nothing to search.",
      citations: [],
      offeredClause: null,
    });
  }

  const documentIds = [...new Set(matches.map((m) => m.document_id))];
  const { data: documents } = await supabase
    .from("documents")
    .select("id, title")
    .in("id", documentIds);

  const titleById = new Map((documents ?? []).map((d) => [d.id, d.title as string]));
  const docIdByTitle = new Map((documents ?? []).map((d) => [d.title as string, d.id as string]));

  const retrieved: RetrievedChunk[] = matches.map((m) => ({
    documentTitle: titleById.get(m.document_id) ?? "Unknown document",
    pageNumber: m.page_number,
    clauseLabel: m.clause_label,
    content: m.content,
  }));

  const answer = await askWithCitations(question, retrieved);

  const { citations, offeredClause } = await buildCitations({
    matches,
    answer,
    documentIds,
    titleById,
    docIdByTitle,
  });

  return Response.json({ answer, citations, offeredClause });
}
