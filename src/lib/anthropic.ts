import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";

const client = new Anthropic();

export interface RetrievedChunk {
  documentTitle: string;
  pageNumber: number | null;
  clauseLabel: string | null;
  content: string;
}

const SYSTEM_PROMPT = `You are Standards Assistant, helping architects find answers in Australian Standards documents.
Answer ONLY using the excerpts provided below — never use outside knowledge.
Mention the specific clause number or page number behind every claim, written naturally in your own sentence (e.g. "clause 9.2.3 requires..." or "as shown on p.212") — precision matters, but there's no special format to follow; write it however reads most naturally.
Whenever you refer to a diagram or table, name it exactly as it appears in the excerpts (e.g. "Figure 9.2.3" or "Table 3.3.4") — the application automatically displays that image alongside your answer when you name it this way, so always use the figure/table's exact name rather than a paraphrase like "the wind regions map." You don't have image-generation or image-display ability yourself, but the app does, so never say you "can't display images" — just name the figure/table and it will appear on its own.
The excerpts may come from several different Standards documents at once — when more than one genuinely applies to the question, address each one and be explicit about which document each requirement comes from, and note plainly if two sources conflict or vary by jurisdiction.
You have a search_standards tool. The excerpts you start with are usually enough, but call it when they genuinely aren't — most importantly when an excerpt explicitly points elsewhere (e.g. "Part 10.3 contains the required height...") and that target wasn't provided, or when you need a specific clause/figure/table that clearly exists in these Standards but isn't in front of you. Only say the excerpts don't cover something after you've actually tried searching for it. Don't call the tool out of routine caution when what you already have clearly answers the question — every call costs real time, so use it deliberately, not reflexively.
If, even after searching, the material genuinely doesn't cover the question, say so plainly instead of guessing.
Write conversationally by default — like a knowledgeable colleague explaining it plainly — rather than a dense formal report with heavy headers and bullet-point-per-clause structure. Only switch to a fuller, more formal/exhaustive breakdown when the question itself asks for that (e.g. "give me the full clause text" or "list every requirement in section 9.5").
State answers directly and assertively — say what the requirement IS, not that you're "reporting on what the excerpts say". Never preface an answer with meta-commentary about your sources, e.g. "Based on the excerpts provided," "According to the provided material," "The excerpts indicate," or similar — that framing reads as hedging. Only flag uncertainty plainly on the rare occasion the material genuinely doesn't cover the question — don't hedge routine, well-supported answers.`;

const SEARCH_TOOL: Tool = {
  name: "search_standards",
  description:
    "Search the uploaded Standards documents for additional excerpts. Call this when what you already have doesn't fully answer the question — for example, an excerpt references another clause, Part, Table, or Figure that wasn't provided, or you need more detail than what's currently available. Each call runs a fresh search, so phrase the query specifically: a clause/Part number (e.g. \"clause 10.3\" or \"Part 10.3\"), a figure/table name, or the exact topic you're missing.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to search for — a clause/Part number, a figure/table name, or a specific topic.",
      },
    },
    required: ["query"],
  },
};

function formatExcerpts(chunks: RetrievedChunk[], startIndex: number): string {
  return chunks
    .map((c, i) => {
      const ref = c.clauseLabel
        ? `clause ${c.clauseLabel}`
        : c.pageNumber
          ? `p.${c.pageNumber}`
          : "unknown location";
      return `[Excerpt ${startIndex + i + 1} — ${c.documentTitle}, ${ref}]\n${c.content}`;
    })
    .join("\n\n");
}

// A hard cap on how many extra searches one answer can trigger — bounds worst-case
// latency/cost for a single question regardless of how the model behaves.
const MAX_TOOL_CALLS = 3;
// A genuinely empty answer string is falsy in the client's `{answer && (...)}`
// check, so it silently renders nothing at all — no card, no error, the "Ask"
// button just flips back with no visible sign anything went wrong. Guarantee the
// user always sees something instead of a silent no-op.
const FALLBACK_TEXT =
  "I wasn't able to put together an answer for that one — try asking again, or rephrase the question.";

/** Answers a question from an initial batch of excerpts, but lets Claude call
 * `search` for more when that batch genuinely doesn't cover the question — e.g. an
 * excerpt points to another clause that wasn't retrieved. `search` is provided by
 * the caller (src/app/api/ask/route.ts) so this stays Claude-only, no direct
 * Supabase/Voyage knowledge here. */
export async function askWithCitations(
  question: string,
  initialChunks: RetrievedChunk[],
  search: (query: string) => Promise<RetrievedChunk[]>
): Promise<string> {
  let excerptCount = initialChunks.length;
  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Excerpts:\n\n${formatExcerpts(initialChunks, 0)}\n\nQuestion: ${question}`,
    },
  ];

  for (let call = 0; call <= MAX_TOOL_CALLS; call++) {
    const forceFinalAnswer = call === MAX_TOOL_CALLS;
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: forceFinalAnswer ? undefined : [SEARCH_TOOL],
      messages,
    });

    if (response.stop_reason !== "tool_use" || forceFinalAnswer) {
      const textBlock = response.content.find((block) => block.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text.trim() : "";
      return text || FALLBACK_TEXT;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      response.content
        .filter((block) => block.type === "tool_use")
        .map(async (block) => {
          const query = typeof block.input === "object" && block.input && "query" in block.input
            ? String((block.input as { query: unknown }).query)
            : "";
          const found = query ? await search(query) : [];
          const text =
            found.length > 0
              ? formatExcerpts(found, excerptCount)
              : "No additional excerpts found for that search.";
          excerptCount += found.length;
          return { tool_use_id: block.id, type: "tool_result" as const, content: text };
        })
    );

    messages.push({ role: "user", content: toolResults });
  }

  return FALLBACK_TEXT;
}

/** Short, scannable title for a favourited Q&A — a trivial summarization, so a cheap/fast model is fine here. */
export async function generateFavouriteTitle(
  question: string,
  answer: string
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 30,
    system:
      "Write a concise 5-8 word title summarizing this Q&A, suitable for a sidebar list entry. No quotes, no trailing period, no markdown — plain text only.",
    messages: [
      {
        role: "user",
        content: `Question: ${question}\n\nAnswer: ${answer.slice(0, 1000)}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text.trim() : "";
}
