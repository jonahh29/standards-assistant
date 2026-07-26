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
If the excerpts don't contain enough information to answer, say so plainly instead of guessing.`;

export async function askWithCitations(
  question: string,
  chunks: RetrievedChunk[]
): Promise<string> {
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

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Excerpts:\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
