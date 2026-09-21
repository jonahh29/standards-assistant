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

// A raw `ilike '8.1%'` prefix match doesn't respect the dot as a segment
// boundary — it also catches numeric siblings like "8.10"/"8.19" that just happen
// to share the same leading characters as "8.1", not actual sub-clauses of it.
// For a short, common prefix (which cross-references routinely are — "Part 2.2",
// "clause 8.1") that fan-out was pulling in 2-3x the intended chunk count, which
// directly bloated the prompt sent to Claude and was the single biggest driver of
// slow answers (measured via scripts/profile-ask.mjs: one real question went from
// 40 relevant chunks to 144 total, 120k input tokens, and a 12.6s model call). A
// genuine match is: the clause itself, a dotted sub-clause (8.1.1), or a lettered
// variant (8.1a) — never a numeric sibling (8.10). Filtering client-side (rather
// than trying to express this as a single ilike/regex pattern) keeps the letter
// case correct without fighting PostgREST's limited pattern syntax.
function isGenuineClauseMatch(label: string, prefix: string, includeSubClauses: boolean): boolean {
  if (label.toLowerCase() === prefix.toLowerCase()) return true;
  if (!includeSubClauses) return false;
  if (label.toLowerCase().startsWith(`${prefix.toLowerCase()}.`)) return true;
  return label.length === prefix.length + 1 && /[a-z]/i.test(label[label.length - 1]);
}

async function exactClauseLookup(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clauseNumbers: string[],
  filterIds: string[],
  // Sub-clause expansion (8.4 -> 8.4.1, 8.4.2, ...) makes sense when the *user*
  // named a clause directly — they're asking about that whole area. It's wrong
  // for a cross-reference merely mentioned inside another excerpt ("Part 8.4
  // contains...") — that's a pointer to one specific clause, not an invitation to
  // pull in its entire sub-tree. Measured live: expanding cross-references pulled
  // in every sub-clause of a short, common number across every document sharing
  // that numbering scheme — one real question ballooned from 40 relevant chunks
  // to 144 (120k input tokens, a 12.6s model call) this way. Exact-match-only
  // brought the same cross-references down to 2 rows.
  includeSubClauses: boolean
): Promise<MatchRow[]> {
  if (clauseNumbers.length === 0) return [];
  const { data } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, page_number, page_end, clause_label")
    .or(clauseNumbers.map((c) => `clause_label.ilike.${c}%`).join(","))
    .in("document_id", filterIds);
  return (data ?? []).filter(
    (row) =>
      row.clause_label &&
      clauseNumbers.some((c) => isGenuineClauseMatch(row.clause_label!, c, includeSubClauses))
  );
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
  // Selects title here too and hands it straight to runAsk — it used to only
  // select `id` and let runAsk query `documents` a second time for titles, which
  // was a fully redundant extra round trip to the same table on every question.
  const { data: allowedDocs } = await supabase
    .from("documents")
    .select("id, title")
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

  // Built from allowedDocs (a superset of filterIds) rather than re-querying —
  // covers every id runAsk could possibly need to look up a title for.
  const titleById = new Map((allowedDocs ?? []).map((d) => [d.id as string, d.title as string]));
  const docIdByTitle = new Map(
    (allowedDocs ?? []).map((d) => [d.title as string, d.id as string])
  );

  try {
    return await runAsk(supabase, question, filterIds, titleById, docIdByTitle);
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
  filterIds: string[],
  titleById: Map<string, string>,
  docIdByTitle: Map<string, string>
): Promise<Response> {
  // Guarantee any clause number the user names explicitly is included, even if it
  // didn't rank in the top vector matches. Only depends on the raw question text,
  // not on the embedding or vector search results, so it runs concurrently with
  // them instead of after — one fewer round trip in the critical path.
  const clauseNumbers = [...new Set(question.match(CLAUSE_PATTERN) ?? [])] as string[];
  const [[questionEmbedding], exactMatches] = await Promise.all([
    embedTexts([question]),
    exactClauseLookup(supabase, clauseNumbers, filterIds, true),
  ]);

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
  const crossRefMatches = await exactClauseLookup(supabase, crossRefNumbers, filterIds, false);

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
    const freshExactMatches = await exactClauseLookup(supabase, queryClauseNumbers, filterIds, true);

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
