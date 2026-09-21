// One-off diagnostic: times each stage of the /api/ask pipeline directly against
// live Supabase/Voyage/Anthropic, bypassing the HTTP + auth layer entirely (same
// .env.local-reading pattern as the other scripts/*.mjs one-offs in this repo).
// Usage: node scripts/profile-ask.mjs "your question here"
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const question =
  process.argv[2] || "What glazing requires human impact safety treatment near a doorway?";

function mark(label, t0) {
  const dt = Date.now() - t0;
  console.log(`  ${label}: ${dt}ms`);
  return Date.now();
}

async function embedTexts(texts) {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model: "voyage-3.5", output_dimension: 1024 }),
  });
  if (!response.ok) throw new Error(`Voyage failed: ${response.status} ${await response.text()}`);
  const json = await response.json();
  return json.data.map((d) => d.embedding);
}

console.log(`\nQuestion: "${question}"\n`);
const overallStart = Date.now();
let t = Date.now();

const { data: allDocuments } = await supabase.from("documents").select("id, title, product");
t = mark("fetch documents", t);
const filterIds = allDocuments.map((d) => d.id);
const titleById = new Map(allDocuments.map((d) => [d.id, d.title]));

const [questionEmbedding] = await embedTexts([question]);
t = mark("embed question (Voyage)", t);

const { data: vectorMatches, error: matchError } = await supabase.rpc(
  "match_document_chunks_diverse",
  {
    query_embedding: questionEmbedding,
    chunks_per_document: 10,
    max_documents: 6,
    filter_document_ids: filterIds,
  }
);
if (matchError) throw new Error(matchError.message);
t = mark(`vector search RPC (${vectorMatches.length} chunks)`, t);

function isGenuineClauseMatch(label, prefix, includeSubClauses) {
  if (label.toLowerCase() === prefix.toLowerCase()) return true;
  if (!includeSubClauses) return false;
  if (label.toLowerCase().startsWith(`${prefix.toLowerCase()}.`)) return true;
  return label.length === prefix.length + 1 && /[a-z]/i.test(label[label.length - 1]);
}

const CLAUSE_PATTERN = /\b(?:\d{1,2}(?:\.\d{1,3}){1,4}[a-z]?|[A-Z]\d+[A-Z]\d+)\b/g;
const clauseNumbers = [...new Set(question.match(CLAUSE_PATTERN) ?? [])];
let exactMatches = [];
if (clauseNumbers.length > 0) {
  const { data } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, page_number, page_end, clause_label")
    .or(clauseNumbers.map((c) => `clause_label.ilike.${c}%`).join(","))
    .in("document_id", filterIds);
  exactMatches = (data ?? []).filter(
    (row) => row.clause_label && clauseNumbers.some((c) => isGenuineClauseMatch(row.clause_label, c, true))
  );
}
t = mark(`exact clause lookup (${clauseNumbers.length} numbers: ${clauseNumbers.join(", ")})`, t);

const CROSS_REF_PATTERN = /\b(?:Part|[Cc]lause)\s+(\d+(?:\.\d+)*)\b|\b([A-Z]\d+[A-Z]\d+)\b/g;
const crossRefNumbers = [
  ...new Set(
    vectorMatches
      .slice(0, 8)
      .flatMap((m) => [...m.content.matchAll(CROSS_REF_PATTERN)].map((cm) => cm[1] ?? cm[2]))
  ),
].slice(0, 5);
let crossRefMatches = [];
if (crossRefNumbers.length > 0) {
  const { data } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, page_number, page_end, clause_label")
    .or(crossRefNumbers.map((c) => `clause_label.ilike.${c}%`).join(","))
    .in("document_id", filterIds);
  crossRefMatches = (data ?? []).filter(
    (row) => row.clause_label && crossRefNumbers.some((c) => isGenuineClauseMatch(row.clause_label, c, false))
  );
}
t = mark(`cross-ref lookup (${crossRefNumbers.length} refs: ${crossRefNumbers.join(", ")})`, t);

const seen = new Set();
const matches = [];
for (const row of [...vectorMatches, ...exactMatches, ...crossRefMatches]) {
  if (seen.has(row.id)) continue;
  seen.add(row.id);
  matches.push(row);
}
console.log(`  -> ${matches.length} total unique chunks retrieved before asking Claude\n`);

const SYSTEM_PROMPT = `You are Standards Assistant, helping architects find answers in Australian Standards documents.
Answer ONLY using the excerpts provided below — never use outside knowledge.
Mention the specific clause number or page number behind every claim, written naturally in your own sentence (e.g. "clause 9.2.3 requires..." or "as shown on p.212") — precision matters, but there's no special format to follow; write it however reads most naturally.
Whenever you refer to a diagram or table, name it exactly as it appears in the excerpts (e.g. "Figure 9.2.3" or "Table 3.3.4") — the application automatically displays that image alongside your answer when you name it this way, so always use the figure/table's exact name rather than a paraphrase like "the wind regions map." You don't have image-generation or image-display ability yourself, but the app does, so never say you "can't display images" — just name the figure/table and it will appear on its own.
The excerpts may come from several different Standards documents at once — when more than one genuinely applies to the question, address each one and be explicit about which document each requirement comes from, and note plainly if two sources conflict or vary by jurisdiction.
You have a search_standards tool. The excerpts you start with are usually enough, but call it when they genuinely aren't — most importantly when an excerpt explicitly points elsewhere (e.g. "Part 10.3 contains the required height...") and that target wasn't provided, or when you need a specific clause/figure/table that clearly exists in these Standards but isn't in front of you. Only say the excerpts don't cover something after you've actually tried searching for it. Don't call the tool out of routine caution when what you already have clearly answers the question — every call costs real time, so use it deliberately, not reflexively.
If, even after searching, the material genuinely doesn't cover the question, say so plainly instead of guessing.
Write conversationally by default — like a knowledgeable colleague explaining it plainly — rather than a dense formal report with heavy headers and bullet-point-per-clause structure. Only switch to a fuller, more formal/exhaustive breakdown when the question itself asks for that (e.g. "give me the full clause text" or "list every requirement in section 9.5").
State answers directly and assertively — say what the requirement IS, not that you're "reporting on what the excerpts say". Never preface an answer with meta-commentary about your sources, e.g. "Based on the excerpts provided," "According to the provided material," "The excerpts indicate," or similar — that framing reads as hedging. Only flag uncertainty plainly on the rare occasion the material genuinely doesn't cover the question — don't hedge routine, well-supported answers.`;

const SEARCH_TOOL = {
  name: "search_standards",
  description:
    'Search the uploaded Standards documents for additional excerpts. Call this when what you already have doesn\'t fully answer the question — for example, an excerpt references another clause, Part, Table, or Figure that wasn\'t provided, or you need more detail than what\'s currently available. Each call runs a fresh search, so phrase the query specifically: a clause/Part number (e.g. "clause 10.3" or "Part 10.3"), a figure/table name, or the exact topic you\'re missing.',
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "What to search for." } },
    required: ["query"],
  },
};

function formatExcerpts(chunks, startIndex) {
  return chunks
    .map((c, i) => {
      const ref = c.clause_label
        ? `clause ${c.clause_label}`
        : c.page_number
          ? `p.${c.page_number}`
          : "unknown location";
      return `[Excerpt ${startIndex + i + 1} — ${titleById.get(c.document_id) ?? "Unknown document"}, ${ref}]\n${c.content}`;
    })
    .join("\n\n");
}

const userContent = `Excerpts:\n\n${formatExcerpts(matches, 0)}\n\nQuestion: ${question}`;
console.log(`  prompt size: ~${userContent.length} chars (~${Math.round(userContent.length / 4)} tokens, rough estimate)\n`);

t = Date.now();
const response = await anthropic.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 2048,
  system: SYSTEM_PROMPT,
  tools: [SEARCH_TOOL],
  messages: [{ role: "user", content: userContent }],
});
t = mark(`Claude call (stop_reason=${response.stop_reason})`, t);
console.log(
  `  usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}` +
    (response.usage.cache_read_input_tokens
      ? ` cache_read=${response.usage.cache_read_input_tokens}`
      : " (no prompt caching in use)")
);

if (response.stop_reason === "tool_use") {
  console.log(`  -> Claude wants to call search_standards — this would trigger a SECOND full round trip in production (embed + vector search + another Claude call), adding to total latency.`);
} else {
  const textBlock = response.content.find((b) => b.type === "text");
  console.log(`\n  answer preview: ${(textBlock?.text ?? "").slice(0, 150)}...`);
}

mark("\nTOTAL", overallStart);
