import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface RetrievedChunk {
  documentTitle: string;
  pageNumber: number | null;
  clauseLabel: string | null;
  content: string;
}

const SYSTEM_PROMPT = `You are Standards Assistant, helping architects find answers in Australian Standards documents.
Answer ONLY using the excerpts provided below — never use outside knowledge.
Every claim must cite its source as (Document title, p.PAGE) or (Document title, clause CLAUSE) when a clause number is available.
The excerpts may come from several different Standards documents at once — when more than one genuinely applies to the question, address each one and be explicit about which document each requirement comes from, and note plainly if two sources conflict or vary by jurisdiction.
If the excerpts don't contain enough information to answer, say so plainly instead of guessing.
The application you're part of automatically displays any diagram/figure/table image available for a cited page directly alongside your answer — you don't have image-generation or image-display ability yourself, but the app does, so never say you "can't display images"; just cite the figure/table by name and page as usual, and the image will appear on its own if one exists for that page.
Write conversationally by default — like a knowledgeable colleague explaining it plainly — rather than a dense formal report with heavy headers and bullet-point-per-clause structure. Still cite precisely. Only switch to a fuller, more formal/exhaustive breakdown when the question itself asks for that (e.g. "give me the full clause text" or "list every requirement in section 9.5").
State answers directly and assertively — say what the requirement IS, not that you're "reporting on what the excerpts say". Never preface an answer with meta-commentary about your sources, e.g. "Based on the excerpts provided," "According to the provided material," "The excerpts indicate," or similar — the citation after each claim already shows exactly where it comes from, so that framing is redundant and reads as hedging. Only flag uncertainty plainly on the rare occasion the material genuinely doesn't cover the question — don't hedge routine, well-supported answers.`;

function buildUserMessage(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks
    .map((c, i) => {
      const ref = c.clauseLabel
        ? `clause ${c.clauseLabel}`
        : c.pageNumber
          ? `p.${c.pageNumber}`
          : "unknown location";
      return `[Excerpt ${i + 1} — ${c.documentTitle}, ${ref}]\n${c.content}`;
    })
    .join("\n\n");

  return `Excerpts:\n\n${context}\n\nQuestion: ${question}`;
}

/** Streams text deltas as they arrive, so the caller can forward them to the client
 * immediately instead of waiting for the full answer. */
export async function streamWithCitations(
  question: string,
  chunks: RetrievedChunk[],
  onDelta: (text: string) => void
): Promise<string> {
  const stream = client.messages.stream({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(question, chunks) }],
  });

  stream.on("text", (delta) => onDelta(delta));

  return stream.finalText();
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
