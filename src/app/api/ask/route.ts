import { getSupabaseServerClient } from "@/lib/supabase-server";
import { embedTexts } from "@/lib/voyage";
import { askWithCitations, type RetrievedChunk } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

const MATCH_COUNT = 8;

export async function POST(request: Request) {
  const { question } = await request.json();

  if (!question || typeof question !== "string") {
    return Response.json({ error: "A question is required." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const [questionEmbedding] = await embedTexts([question]);

  const { data: matches, error: matchError } = await supabase.rpc(
    "match_document_chunks",
    { query_embedding: questionEmbedding, match_count: MATCH_COUNT }
  );

  if (matchError) {
    return Response.json({ error: matchError.message }, { status: 500 });
  }

  if (!matches || matches.length === 0) {
    return Response.json({
      answer: "No documents have been uploaded yet, so there's nothing to search.",
      citations: [],
    });
  }

  const documentIds = [...new Set(matches.map((m: { document_id: string }) => m.document_id))];
  const { data: documents } = await supabase
    .from("documents")
    .select("id, title")
    .in("id", documentIds);

  const titleById = new Map((documents ?? []).map((d) => [d.id, d.title as string]));

  const retrieved: RetrievedChunk[] = matches.map(
    (m: {
      document_id: string;
      content: string;
      page_number: number | null;
      clause_label: string | null;
    }) => ({
      documentTitle: titleById.get(m.document_id) ?? "Unknown document",
      pageNumber: m.page_number,
      clauseLabel: m.clause_label,
      content: m.content,
    })
  );

  const answer = await askWithCitations(question, retrieved);

  const citations = retrieved.map((r) => ({
    documentTitle: r.documentTitle,
    pageNumber: r.pageNumber,
    clauseLabel: r.clauseLabel,
  }));

  return Response.json({ answer, citations });
}
