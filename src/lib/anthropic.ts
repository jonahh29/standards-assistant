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
Keep answers tight by default: lead with the direct answer in the first sentence or two, then include only the supporting detail (a key dimension, an exception, a genuinely relevant related requirement) actually needed to apply it. Don't restate background context, cover cases the question didn't raise, or pad with extra caveats just to sound thorough — every sentence should earn its place. Expand into a fuller, more exhaustive answer only when the question explicitly calls for that (e.g. "give me the full clause text," "list every requirement in section 9.5," "explain in detail").
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

export interface StreamCallbacks {
  /** A text delta for the answer currently being written. Only ever called for
   * the call that turns out to be the final answer — see `onReset` below for why
   * an earlier delta can still end up discarded. */
  onDelta: (text: string) => void;
  /** Fires when the call that had been streaming turns out to have been a
   * search_standards call instead of the final answer (Claude occasionally writes
   * a line of "let me check that" before calling the tool). Any deltas already
   * sent for that call were never the real answer — the caller should discard
   * them and keep showing its loading state until new deltas arrive for the next
   * call. Rare in practice (the system prompt asks Claude to call the tool
   * deliberately, not reflexively, and to skip preamble), but must be handled
   * correctly rather than assumed away, since a wrong assumption here is exactly
   * what broke citation rendering the last time streaming was attempted. */
  onReset: () => void;
}

/** Answers a question from an initial batch of excerpts, but lets Claude call
 * `search` for more when that batch genuinely doesn't cover the question — e.g. an
 * excerpt points to another clause that wasn't retrieved. `search` is provided by
 * the caller (src/app/api/ask/route.ts) so this stays Claude-only, no direct
 * Supabase/Voyage knowledge here. `stream`, when provided, forwards text deltas
 * live as each call generates them — every call in the loop streams (not just a
 * detected-in-advance "final" one), since there's no way to know a call will be
 * final until it finishes; `onReset` covers the times that guess was wrong. */
export async function askWithCitations(
  question: string,
  initialChunks: RetrievedChunk[],
  search: (query: string) => Promise<RetrievedChunk[]>,
  stream?: StreamCallbacks
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
    const params = {
      model: "claude-sonnet-5",
      // Sonnet 5 runs adaptive thinking by default even without this block —
      // set explicitly for clarity. Effort "low" (rather than the default
      // "high") was measured directly against 3 real questions via
      // scripts/profile-ask.mjs: call time dropped from ~17-19s to ~7-12s with
      // zero loss of completeness (still correctly caught secondary
      // requirements a "high"-effort Haiku comparison call missed entirely) —
      // this is a Q&A-over-provided-excerpts task, not one that benefits from
      // deep multi-step reasoning, so the extra thinking budget was pure cost.
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Was 2048 — too low once thinking is accounted for: thinking tokens
      // count against max_tokens even though the `thinking` block's own text
      // is omitted (not shown), so a real answer could get silently cut off
      // mid-sentence after an unlucky amount of invisible thinking (reproduced
      // directly: stop_reason "max_tokens" with content_types
      // "thinking,text"). Raised well above anything actually observed
      // (135-1359 output tokens across every real test question) rather than
      // just past the one failure seen.
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: forceFinalAnswer ? undefined : [SEARCH_TOOL],
      messages,
    } as const;

    let response;
    if (stream) {
      const messageStream = client.messages.stream(params);
      messageStream.on("text", stream.onDelta);
      response = await messageStream.finalMessage();
    } else {
      response = await client.messages.create(params);
    }

    if (response.stop_reason !== "tool_use" || forceFinalAnswer) {
      const textBlock = response.content.find((block) => block.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text.trim() : "";
      return text || FALLBACK_TEXT;
    }

    // This call streamed some text (if any) before deciding to call the tool —
    // none of it was the real answer, so tell the caller to discard it.
    stream?.onReset();

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
