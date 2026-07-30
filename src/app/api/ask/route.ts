import { getSupabaseServerClient } from "@/lib/supabase-server";
import { embedTexts } from "@/lib/voyage";
import { streamWithCitations, type RetrievedChunk } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 120;

const CHUNKS_PER_DOCUMENT = 20;
const MAX_DOCUMENTS = 6;
const CLAUSE_PATTERN = /\b\d{1,2}(?:\.\d{1,3}){1,4}[a-z]?\b/g;

interface MatchRow {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  page_end: number | null;
  clause_label: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Retrieval intentionally casts a wide net (up to ~24 chunks across several
// documents) so multi-standard questions get full coverage — but that means many
// retrieved chunks end up not actually used in the answer. Only surface a citation
// (and its figures) if Claude's answer text actually references that clause/page,
// matching the citation style enforced by the system prompt.
function wasActuallyCited(m: MatchRow, answer: string): boolean {
  if (m.clause_label) {
    if (new RegExp(`\\b${escapeRegex(m.clause_label)}\\b`).test(answer)) return true;
  }
  if (m.page_number != null) {
    if (new RegExp(`p\\.\\s?${m.page_number}\\b`).test(answer)) return true;
  }
  return false;
}

// Streams newline-delimited JSON events to the client: {"type":"delta","text":...}
// as the answer is generated, then a final {"type":"citations","citations":[...]}.
// Wrapping every code path (including the "nothing uploaded yet" case) in this same
// protocol keeps the client's reader loop uniform.
function ndjsonStream(build: (write: (event: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        await build(write);
      } catch (err) {
        write({ type: "error", error: err instanceof Error ? err.message : "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

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

  const clauseNumbers = [...new Set(question.match(CLAUSE_PATTERN) ?? [])] as string[];

  const [{ data: vectorMatches, error: matchError }, exactMatches] = await Promise.all([
    supabase.rpc("match_document_chunks_diverse", {
      query_embedding: questionEmbedding,
      chunks_per_document: CHUNKS_PER_DOCUMENT,
      max_documents: MAX_DOCUMENTS,
      filter_document_ids: filterIds,
    }),
    (async () => {
      if (clauseNumbers.length === 0) return [] as MatchRow[];
      let query = supabase
        .from("document_chunks")
        .select("id, document_id, content, page_number, page_end, clause_label")
        .or(clauseNumbers.map((c) => `clause_label.ilike.${c}%`).join(","));
      if (filterIds) query = query.in("document_id", filterIds);
      const { data } = await query;
      return (data ?? []) as MatchRow[];
    })(),
  ]);

  if (matchError) {
    return Response.json({ error: matchError.message }, { status: 500 });
  }

  const seen = new Set<string>();
  const matches: MatchRow[] = [];
  for (const row of [...(vectorMatches ?? []), ...exactMatches]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    matches.push(row);
  }

  if (matches.length === 0) {
    return ndjsonStream(async (write) => {
      write({
        type: "delta",
        text: "No documents have been uploaded yet, so there's nothing to search.",
      });
      write({ type: "citations", citations: [] });
    });
  }

  const documentIds = [...new Set(matches.map((m) => m.document_id))];

  const [{ data: documents }, { data: figureRows }] = await Promise.all([
    supabase.from("documents").select("id, title").in("id", documentIds),
    supabase
      .from("document_figures")
      .select("document_id, page_number, storage_path, label")
      .in("document_id", documentIds),
  ]);

  const titleById = new Map((documents ?? []).map((d) => [d.id, d.title as string]));

  const figuresByPage = new Map<string, { storage_path: string; label: string | null }[]>();
  for (const row of figureRows ?? []) {
    const key = `${row.document_id}:${row.page_number}`;
    if (!figuresByPage.has(key)) figuresByPage.set(key, []);
    figuresByPage.get(key)!.push({ storage_path: row.storage_path, label: row.label });
  }

  const retrieved: RetrievedChunk[] = matches.map((m) => ({
    documentTitle: titleById.get(m.document_id) ?? "Unknown document",
    pageNumber: m.page_number,
    clauseLabel: m.clause_label,
    content: m.content,
  }));

  return ndjsonStream(async (write) => {
    const answer = await streamWithCitations(question, retrieved, (text) => {
      write({ type: "delta", text });
    });

    // Narrow down to citations the answer actually references — falls back to the
    // full retrieved set only if the heuristic finds nothing (safer than showing zero
    // sources on an unusual answer format).
    const citedMatches = matches.filter((m) => wasActuallyCited(m, answer));
    const finalMatches = citedMatches.length > 0 ? citedMatches : matches;

    const citations = await Promise.all(
      finalMatches.map(async (m) => {
        // A clause's text commonly spans onto the page containing its figure, so
        // match figures against the chunk's whole page range, not just its start.
        const start = m.page_number ?? 0;
        const end = m.page_end ?? start;
        const pageFigures = [];
        for (let p = start; p <= end; p++) {
          pageFigures.push(...(figuresByPage.get(`${m.document_id}:${p}`) ?? []));
        }

        const figures = await Promise.all(
          pageFigures.map(async (fig) => {
            const { data: signed } = await supabase.storage
              .from("standards-figures")
              .createSignedUrl(fig.storage_path, 3600);
            return { url: signed?.signedUrl ?? null, label: fig.label, storagePath: fig.storage_path };
          })
        );

        return {
          documentTitle: titleById.get(m.document_id) ?? "Unknown document",
          pageNumber: m.page_number,
          pageEnd: m.page_end,
          clauseLabel: m.clause_label,
          content: m.content,
          figures: figures.filter((f) => f.url),
        };
      })
    );

    write({ type: "citations", citations });
  });
}
