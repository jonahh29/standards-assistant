import { getSupabaseServerClient } from "@/lib/supabase-server";
import { embedTexts } from "@/lib/voyage";
import { askWithCitations, type RetrievedChunk } from "@/lib/anthropic";
import type { Citation } from "@/app/ask/citationMatching";

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
    // Require the word "clause" right before the number — a bare number match (e.g.
    // "0.2") false-positives against ordinary decimal measurements like "0.2 mm".
    // The trailing (?!\.?\d) stops a shorter clause number from matching as a prefix
    // of a longer one — without it, "clause 4.2" matches inside "clause 4.2.8", so an
    // unrelated clause 4.2 in a different document gets falsely credited as cited.
    if (
      new RegExp(`\\bclause\\s+${escapeRegex(m.clause_label)}(?!\\.?\\d)`, "i").test(answer)
    )
      return true;
  }
  if (m.page_number != null) {
    if (new RegExp(`p\\.\\s?${m.page_number}\\b`).test(answer)) return true;
  }
  return false;
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

  // Narrow down to citations the answer actually references — falls back to the
  // full retrieved set only if the heuristic finds nothing (safer than showing zero
  // sources on an unusual answer format).
  const citedMatches = matches.filter((m) => wasActuallyCited(m, answer));
  const finalMatches = citedMatches.length > 0 ? citedMatches : matches;

  // A long clause can get split into multiple stored chunks (chunk.ts's
  // MAX_CLAUSE_CHUNK_SIZE), and only one of those needs to rank well enough to be
  // retrieved for the question — its own page range then stops short of a table that
  // only appears in a later sibling chunk (dense table text ranks poorly on its own).
  // Look up every chunk sharing each cited clause's label so figure-matching uses the
  // clause's true full extent, not just whichever one sub-chunk was retrieved.
  const citedClauseLabels = [...new Set(finalMatches.filter((m) => m.clause_label).map((m) => m.clause_label as string))];
  interface SiblingChunk {
    page_number: number | null;
    page_end: number | null;
    content: string;
    chunk_index: number;
  }
  const clauseChunksByDoc = new Map<string, SiblingChunk[]>();
  if (citedClauseLabels.length > 0) {
    const { data: siblingChunks } = await supabase
      .from("document_chunks")
      .select("document_id, clause_label, page_number, page_end, content, chunk_index")
      .in("document_id", documentIds)
      .in("clause_label", citedClauseLabels);
    for (const row of siblingChunks ?? []) {
      const key = `${row.document_id}:::${row.clause_label}`;
      if (!clauseChunksByDoc.has(key)) clauseChunksByDoc.set(key, []);
      clauseChunksByDoc.get(key)!.push({
        page_number: row.page_number,
        page_end: row.page_end,
        content: row.content,
        chunk_index: row.chunk_index,
      });
    }
  }

  // Flood-fills the matched chunk's own range outward to only the sibling chunks that
  // are contiguous or nearly so (within `slack` pages) — deliberately excludes a
  // same-labeled but far-away chunk (e.g. an unrelated stub reusing the same clause
  // number elsewhere in the document) from ballooning the range.
  function expandClauseRange(
    base: { start: number; end: number },
    siblings: { page_number: number | null; page_end: number | null }[],
    slack = 2
  ): { start: number; end: number } {
    let { start, end } = base;
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of siblings) {
        const sStart = s.page_number ?? start;
        const sEnd = s.page_end ?? sStart;
        const overlaps = sStart <= end + slack && sEnd >= start - slack;
        if (overlaps && (sStart < start || sEnd > end)) {
          start = Math.min(start, sStart);
          end = Math.max(end, sEnd);
          changed = true;
        }
      }
    }
    return { start, end };
  }

  const { data: figureRows } = await supabase
    .from("document_figures")
    .select("document_id, page_number, storage_path, label")
    .in("document_id", documentIds);

  const figuresByPage = new Map<string, { storage_path: string; label: string | null }[]>();
  // A table spanning multiple pages gets one document_figures row per page, all
  // sharing the exact same label (see detectPageLabels) — indexing by label lets a
  // continuation page be found even if a chunk's page range doesn't quite reach it.
  // Some documents reuse generic labels like "Table 1" for many unrelated tables, so
  // matches also carry page_number, letting the lookup below only trust a same-label
  // match that's actually near the cited page range rather than anywhere in the doc.
  const figuresByLabel = new Map<
    string,
    { storage_path: string; label: string | null; page_number: number }[]
  >();
  for (const row of figureRows ?? []) {
    const pageKey = `${row.document_id}:${row.page_number}`;
    if (!figuresByPage.has(pageKey)) figuresByPage.set(pageKey, []);
    figuresByPage.get(pageKey)!.push({ storage_path: row.storage_path, label: row.label });

    for (const sub of (row.label ?? "").split(",").map((s: string) => s.trim()).filter(Boolean)) {
      const labelKey = `${row.document_id}:::${sub}`;
      if (!figuresByLabel.has(labelKey)) figuresByLabel.set(labelKey, []);
      figuresByLabel.get(labelKey)!.push({
        storage_path: row.storage_path,
        label: row.label,
        page_number: row.page_number,
      });
    }
  }

  const rawCitations = await Promise.all(
    finalMatches.map(async (m) => {
      // A clause's text commonly spans onto the page containing its figure, so match
      // figures against the clause's whole page range (expanded across any sibling
      // chunks from a size-triggered split), not just this one chunk's own range.
      const ownStart = m.page_number ?? 0;
      const ownEnd = m.page_end ?? ownStart;
      const siblings = m.clause_label
        ? clauseChunksByDoc.get(`${m.document_id}:::${m.clause_label}`) ?? []
        : [];
      const { start, end } = expandClauseRange({ start: ownStart, end: ownEnd }, siblings);
      const seenPaths = new Set<string>();
      const pageFigures: { storage_path: string; label: string | null }[] = [];
      const addFigure = (fig: { storage_path: string; label: string | null }) => {
        if (seenPaths.has(fig.storage_path)) return;
        seenPaths.add(fig.storage_path);
        pageFigures.push(fig);
      };
      for (let p = start; p <= end; p++) {
        for (const fig of figuresByPage.get(`${m.document_id}:${p}`) ?? []) addFigure(fig);
      }
      // Supplement with a same-labeled figure just outside the page range — picks up a
      // multi-page table's continuation page even when a chunk's page_end falls just
      // short of it. Capped to a small distance so a generic reused label (some
      // documents caption every table just "Table 1") can't pull in an unrelated
      // table from elsewhere in the document.
      const NEARBY_PAGES = 3;
      for (const fig of [...pageFigures]) {
        for (const sub of (fig.label ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
          for (const match of figuresByLabel.get(`${m.document_id}:::${sub}`) ?? []) {
            const distance = Math.min(
              Math.abs(match.page_number - start),
              Math.abs(match.page_number - end)
            );
            if (distance <= NEARBY_PAGES) addFigure(match);
          }
        }
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
        figures: figures.filter((f) => f.url) as Citation["figures"],
      };
    })
  );

  // A clause number can appear in more than one retrieved chunk — e.g. a bare heading
  // line from a contents/summary listing alongside the chunk with the clause's actual
  // body text, or (as with an oversized clause) a size-triggered split where a later
  // sub-chunk's page range reaches further than the first. Keep the richest (most
  // content) chunk's text for the popover — a stub heading should never win that — but
  // union every candidate's figures rather than discarding the loser's entirely, since
  // a chunk with less prose can still have found a figure the winner's page range missed.
  const bestByKey = new Map<string, Citation>();
  for (const c of rawCitations) {
    const key = `${c.documentTitle}:::${c.clauseLabel ?? `p${c.pageNumber}`}`;
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, c);
      continue;
    }
    const richer = c.content.length > existing.content.length ? c : existing;
    const other = richer === c ? existing : c;
    const seenPaths = new Set(richer.figures.map((f) => f.storagePath));
    const mergedFigures = [...richer.figures];
    for (const fig of other.figures) {
      if (!seenPaths.has(fig.storagePath)) {
        seenPaths.add(fig.storagePath);
        mergedFigures.push(fig);
      }
    }
    bestByKey.set(key, { ...richer, figures: mergedFigures });
  }
  const citations = [...bestByKey.values()];

  // Offer to pull up the most substantial clause discussed, so the user can get the
  // literal source page(s) on demand via a button rather than the answer trying to
  // cram it all in. Points at the actual rendered PDF page image, not extracted text —
  // a single stored chunk is often only part of the clause (see the size-triggered
  // split above), so "the full clause" needs the clause's true full page range,
  // expanded across any sibling chunks the same way figure-lookup does above.
  const offeredClauseCandidate =
    citations
      .filter((c) => c.clauseLabel)
      .sort((a, b) => b.content.length - a.content.length)[0] ?? null;

  let offeredClause: {
    documentId: string;
    documentTitle: string;
    clauseLabel: string;
    pageStart: number;
    pageEnd: number;
  } | null = null;

  if (offeredClauseCandidate?.clauseLabel) {
    const docId = docIdByTitle.get(offeredClauseCandidate.documentTitle);
    if (docId) {
      const siblings = clauseChunksByDoc.get(`${docId}:::${offeredClauseCandidate.clauseLabel}`) ?? [];
      const ownStart = offeredClauseCandidate.pageNumber ?? 0;
      const ownEnd = offeredClauseCandidate.pageEnd ?? ownStart;
      const { start, end } = expandClauseRange({ start: ownStart, end: ownEnd }, siblings);
      offeredClause = {
        documentId: docId,
        documentTitle: offeredClauseCandidate.documentTitle,
        clauseLabel: offeredClauseCandidate.clauseLabel,
        pageStart: start,
        pageEnd: end,
      };
    }
  }

  return Response.json({ answer, citations, offeredClause });
}
