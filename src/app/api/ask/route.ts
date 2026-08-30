import { getSupabaseServerClient } from "@/lib/supabase-server";
import { embedTexts } from "@/lib/voyage";
import { askWithCitations, type RetrievedChunk } from "@/lib/anthropic";
import { buildCitations, type MatchRow } from "@/lib/citationBuilder";
import { getSessionUser, getAllowedProducts } from "@/lib/supabase-session";

export const runtime = "nodejs";
export const maxDuration = 120;

// Now that Claude can call search_standards for a gap in the initial batch (see
// src/lib/anthropic.ts), this doesn't need to be as wide as it once was — a smaller
// upfront fetch keeps the common case (no extra search needed) fast and cheap, while
// a hard question can trigger a precisely-targeted follow-up search instead of
// hoping a wider blind fetch happened to include the right thing.
const CHUNKS_PER_DOCUMENT = 10;
const MAX_DOCUMENTS = 6;
// Matches both the decimal numbering the other three documents use (e.g. "9.2.3")
// and NCC Volume One's letter-code format (e.g. "F5D2") — see chunk.ts's
// CLAUSE_HEADER_PATTERN for the same pair of shapes used at chunking time.
const CLAUSE_PATTERN = /\b(?:\d{1,2}(?:\.\d{1,3}){1,4}[a-z]?|[A-Z]\d+[A-Z]\d+)\b/g;
// Explanatory notes commonly point elsewhere for the actual figure, e.g. "Part 10.3
// contains the required height for a ceiling above a stairway..." — that note can
// rank well (it's specifically about stairways) while the clause it points to ranks
// far lower on its own (it's about room heights generally, stairways are just one
// bullet among several). Following an explicit reference like this directly is more
// reliable than hoping the target clause also ranks highly by raw similarity. Kept
// alongside the search tool since it's free (no extra Claude round-trip) and already
// resolves some of these cases before Claude would even need to ask.
// Decimal numbers need the "Part"/"clause" prefix to avoid over-triggering on
// random numbers, but NCC Volume One's letter-code format is distinctive enough
// (and is routinely referenced bare, e.g. "complying with— F5D2; and") to follow
// without requiring a prefix word at all.
const CROSS_REF_PATTERN =
  /\b(?:Part|[Cc]lause)\s+(\d+(?:\.\d+)*)\b|\b([A-Z]\d+[A-Z]\d+)\b/g;
const CROSS_REF_SOURCE_LIMIT = 8;
const CROSS_REF_TARGET_LIMIT = 5;

async function exactClauseLookup(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clauseNumbers: string[],
  filterIds: string[]
): Promise<MatchRow[]> {
  if (clauseNumbers.length === 0) return [];
  const { data } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, page_number, page_end, clause_label")
    .or(clauseNumbers.map((c) => `clause_label.ilike.${c}%`).join(","))
    .in("document_id", filterIds);
  return data ?? [];
}

export async function POST(request: Request) {
  const { question, documentIds: filterDocumentIds } = await request.json();

  if (!question || typeof question !== "string") {
    return Response.json({ error: "A question is required." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // Every document is scoped to a product (residential/commercial), and a user can
  // only ever search what their account has been granted — this is the real
  // enforcement, not just which checkboxes the client happens to show. Never trust
  // the client-supplied documentIds filter on its own: intersect it with what this
  // user is actually allowed, so a residential-only account can't be made to reach a
  // commercial document id directly (e.g. via devtools).
  const sessionUser = await getSessionUser();
  const allowedProducts = getAllowedProducts(sessionUser);
  const { data: allowedDocs } = await supabase
    .from("documents")
    .select("id")
    .in("product", allowedProducts.length > 0 ? allowedProducts : ["__none__"]);
  const allowedDocumentIds = (allowedDocs ?? []).map((d) => d.id as string);

  if (allowedDocumentIds.length === 0) {
    return Response.json({
      answer:
        "You don't have access to any documents yet — ask your admin to grant you access.",
      citations: [],
      offeredClause: null,
    });
  }

  const requestedIds: string[] =
    Array.isArray(filterDocumentIds) && filterDocumentIds.length > 0 ? filterDocumentIds : [];
  const scopedRequestedIds = requestedIds.filter((id) => allowedDocumentIds.includes(id));
  const filterIds = scopedRequestedIds.length > 0 ? scopedRequestedIds : allowedDocumentIds;

  try {
    return await runAsk(supabase, question, filterIds);
  } catch (err) {
    // An uncaught error here (e.g. Anthropic rejecting an invalid API key) would
    // otherwise return Next's default HTML error page, which the client's
    // res.json() can't parse — that silently killed the request client-side and
    // left the UI stuck on "Searching..." forever instead of showing an error.
    console.error("Ask failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Something went wrong answering that." },
      { status: 500 }
    );
  }
}

async function runAsk(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  question: string,
  filterIds: string[]
): Promise<Response> {
  // Fetched once, upfront, independent of what the initial retrieval happens to
  // surface — a search_standards call mid-answer can discover a chunk from a
  // document the initial batch didn't touch at all, and it still needs a title.
  // Scoped to filterIds (already the caller's allowed-products set) so this never
  // hands a document title from outside the user's access to Claude either.
  const { data: allDocuments } = await supabase
    .from("documents")
    .select("id, title")
    .in("id", filterIds);
  const titleById = new Map((allDocuments ?? []).map((d) => [d.id, d.title as string]));
  const docIdByTitle = new Map((allDocuments ?? []).map((d) => [d.title as string, d.id as string]));

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
  const exactMatches = await exactClauseLookup(supabase, clauseNumbers, filterIds);

  // Follow an explicit "Part X" / "clause X" reference made inside one of the
  // top-ranked excerpts themselves, even if that target clause doesn't rank highly
  // on its own for this question's wording.
  const crossRefNumbers = [
    ...new Set(
      (vectorMatches ?? [])
        .slice(0, CROSS_REF_SOURCE_LIMIT)
        .flatMap((m: MatchRow) =>
          [...m.content.matchAll(CROSS_REF_PATTERN)].map((cm) => cm[1] ?? cm[2])
        )
    ),
  ].slice(0, CROSS_REF_TARGET_LIMIT) as string[];
  const crossRefMatches = await exactClauseLookup(supabase, crossRefNumbers, filterIds);

  const seen = new Set<string>();
  const matches: MatchRow[] = [];
  for (const row of [...(vectorMatches ?? []), ...exactMatches, ...crossRefMatches]) {
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

  const toRetrievedChunk = (m: MatchRow): RetrievedChunk => ({
    documentTitle: titleById.get(m.document_id) ?? "Unknown document",
    pageNumber: m.page_number,
    clauseLabel: m.clause_label,
    content: m.content,
  });

  // Backs the search_standards tool — mutates the same `matches`/`seen` accumulator
  // the initial retrieval built, so anything Claude finds mid-answer ends up in the
  // final citations exactly like the initial batch does.
  async function search(query: string): Promise<RetrievedChunk[]> {
    const [queryEmbedding] = await embedTexts([query]);
    const { data: freshVectorMatches } = await supabase.rpc("match_document_chunks_diverse", {
      query_embedding: queryEmbedding,
      chunks_per_document: CHUNKS_PER_DOCUMENT,
      max_documents: MAX_DOCUMENTS,
      filter_document_ids: filterIds,
    });

    const queryClauseNumbers = [...new Set(query.match(CLAUSE_PATTERN) ?? [])] as string[];
    const freshExactMatches = await exactClauseLookup(supabase, queryClauseNumbers, filterIds);

    const fresh: MatchRow[] = [];
    for (const row of [...(freshVectorMatches ?? []), ...freshExactMatches]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      matches.push(row);
      fresh.push(row);
    }

    return fresh.map(toRetrievedChunk);
  }

  const answer = await askWithCitations(question, matches.map(toRetrievedChunk), search);

  // `matches` may have grown since the initial batch if search_standards was
  // called — recomputed after the answer so citations reflect everything actually
  // available to Claude, not just what was retrieved upfront.
  const documentIds = [...new Set(matches.map((m) => m.document_id))];

  const { citations, offeredClause } = await buildCitations({
    matches,
    answer,
    documentIds,
    titleById,
    docIdByTitle,
  });

  return Response.json({ answer, citations, offeredClause });
}
