import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { Citation } from "@/app/ask/citationMatching";

export interface MatchRow {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  page_end: number | null;
  clause_label: string | null;
}

export interface OfferedClause {
  documentId: string;
  documentTitle: string;
  clauseLabel: string;
  pageStart: number;
  pageEnd: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Only surface a citation (and its figures) if the answer text actually references
// that clause/page, matching the citation style Claude is asked to use. Retrieval
// intentionally casts a wide net, so most retrieved chunks end up unused.
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

// Flood-fills the matched chunk's own range outward to only the sibling chunks that
// directly overlap it (slack=0) — deliberately excludes a same-labeled but distinct
// chunk elsewhere in the document (e.g. a table-of-contents stub, a version-history
// table row reusing "1.1" to mean a revision number, not clause 1.1). A nonzero slack
// seems tempting for "nearly adjacent" continuations, but every genuine same-clause
// split observed in this codebase's actual chunking shares its starting page_number
// exactly (a chunk.ts quirk: a size-triggered split doesn't advance the tracked
// page), so it always overlaps directly — slack only ever risked bridging through an
// unrelated stub into a wrong, wider range.
function expandClauseRange(
  base: { start: number; end: number },
  siblings: { page_number: number | null; page_end: number | null }[],
  slack = 0
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

/** Turns a set of retrieved chunks plus the answer text that was generated from them
 * into the final `citations` array (with signed figure URLs) and an `offeredClause`
 * pick — shared by /api/ask and /api/compliance/check so this fairly intricate
 * figure-matching logic only needs to be maintained in one place. */
export async function buildCitations(params: {
  matches: MatchRow[];
  answer: string;
  documentIds: string[];
  titleById: Map<string, string>;
  docIdByTitle: Map<string, string>;
}): Promise<{ citations: Citation[]; offeredClause: OfferedClause | null }> {
  const { matches, answer, documentIds, titleById, docIdByTitle } = params;
  const supabase = getSupabaseServerClient();

  const citedMatches = matches.filter((m) => wasActuallyCited(m, answer));
  const finalMatches = citedMatches.length > 0 ? citedMatches : matches;

  // A long clause can get split into multiple stored chunks (chunk.ts's
  // MAX_CLAUSE_CHUNK_SIZE), and only one of those needs to rank well enough to be
  // retrieved for the question — its own page range then stops short of a table that
  // only appears in a later sibling chunk (dense table text ranks poorly on its own).
  // Look up every chunk sharing each cited clause's label so figure-matching uses the
  // clause's true full extent, not just whichever one sub-chunk was retrieved.
  const citedClauseLabels = [
    ...new Set(finalMatches.filter((m) => m.clause_label).map((m) => m.clause_label as string)),
  ];
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
      // A clause's own explanatory figure sometimes sits just past where its last
      // retrieved chunk happens to end (the size-triggered split can cut off right
      // before it) without sharing a label with anything already in range — e.g. a
      // table series ending on the same page a lone "Figure X" caption starts on a
      // different label. Check a small trailing buffer for any figure there, but
      // only if that page isn't already claimed by a different cited clause (i.e.
      // genuinely the next section, not a continuation of this one).
      const TRAILING_BUFFER = 2;
      for (let p = end + 1; p <= end + TRAILING_BUFFER; p++) {
        const claimedByOther = finalMatches.some(
          (other) =>
            other.document_id === m.document_id &&
            other.clause_label &&
            other.clause_label !== m.clause_label &&
            (other.page_number === p || other.page_end === p)
        );
        if (claimedByOther) break;
        for (const fig of figuresByPage.get(`${m.document_id}:${p}`) ?? []) addFigure(fig);
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

  // Offer to pull up the clause the answer actually centers on, so the user can get
  // the literal source page(s) on demand via a button rather than the answer trying
  // to cram it all in. "Most content" was a weak proxy for "most relevant" - a
  // citation can carry a lot of text while only being tangentially mentioned once
  // (e.g. cited by page rather than by clause), while the clause the answer actually
  // walks through in depth gets referenced by name repeatedly. Counting how many
  // times each clause is actually named in the answer is a much more direct signal.
  // When multiple clauses tie on mention count (e.g. several each mentioned exactly
  // once), "most content" was also a poor tie-break - it can pick a clause that's
  // only a brief aside near the end over the one the answer actually opens with and
  // explains in depth. Whichever is named earliest in the answer is a much better
  // signal of "the main subject", since answers here lead with their main point.
  const offeredClauseCandidate =
    citations
      .filter((c) => c.clauseLabel)
      .map((c) => {
        const re = new RegExp(`\\bclause\\s+${escapeRegex(c.clauseLabel!)}(?!\\.?\\d)`, "gi");
        const mentionCount = (answer.match(re) ?? []).length;
        const firstIndex = answer.search(re);
        return { c, mentionCount, firstIndex: firstIndex === -1 ? Infinity : firstIndex };
      })
      .sort((a, b) => b.mentionCount - a.mentionCount || a.firstIndex - b.firstIndex)[0]?.c ?? null;

  let offeredClause: OfferedClause | null = null;

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

  return { citations, offeredClause };
}
