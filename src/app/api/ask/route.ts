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

  const { data: figureRows } = await supabase
    .from("document_figures")
    .select("document_id, page_number, storage_path, label")
    .in("document_id", documentIds);

  const figuresByPage = new Map<string, { storage_path: string; label: string | null }[]>();
  for (const row of figureRows ?? []) {
    const key = `${row.document_id}:${row.page_number}`;
    if (!figuresByPage.has(key)) figuresByPage.set(key, []);
    figuresByPage.get(key)!.push({ storage_path: row.storage_path, label: row.label });
  }

  const citations = await Promise.all(
    matches.map(
      async (
        m: { document_id: string; page_number: number | null; clause_label: string | null },
        i: number
      ) => {
        const key = `${m.document_id}:${m.page_number}`;
        const pageFigures = figuresByPage.get(key) ?? [];

        const figures = await Promise.all(
          pageFigures.map(async (fig) => {
            const { data: signed } = await supabase.storage
              .from("standards-figures")
              .createSignedUrl(fig.storage_path, 3600);
            return { url: signed?.signedUrl ?? null, label: fig.label };
          })
        );

        return {
          documentTitle: retrieved[i].documentTitle,
          pageNumber: m.page_number,
          clauseLabel: m.clause_label,
          figures: figures.filter((f) => f.url),
        };
      }
    )
  );

  return Response.json({ answer, citations });
}
