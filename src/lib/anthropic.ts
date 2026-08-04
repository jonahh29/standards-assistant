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
Mention the specific clause number or page number behind every claim, written naturally in your own sentence (e.g. "clause 9.2.3 requires..." or "as shown on p.212") — precision matters, but there's no special format to follow; write it however reads most naturally.
Whenever you refer to a diagram or table, name it exactly as it appears in the excerpts (e.g. "Figure 9.2.3" or "Table 3.3.4") — the application automatically displays that image alongside your answer when you name it this way, so always use the figure/table's exact name rather than a paraphrase like "the wind regions map." You don't have image-generation or image-display ability yourself, but the app does, so never say you "can't display images" — just name the figure/table and it will appear on its own.
The excerpts may come from several different Standards documents at once — when more than one genuinely applies to the question, address each one and be explicit about which document each requirement comes from, and note plainly if two sources conflict or vary by jurisdiction.
If the excerpts don't contain enough information to answer, say so plainly instead of guessing.
Write conversationally by default — like a knowledgeable colleague explaining it plainly — rather than a dense formal report with heavy headers and bullet-point-per-clause structure. Only switch to a fuller, more formal/exhaustive breakdown when the question itself asks for that (e.g. "give me the full clause text" or "list every requirement in section 9.5").
State answers directly and assertively — say what the requirement IS, not that you're "reporting on what the excerpts say". Never preface an answer with meta-commentary about your sources, e.g. "Based on the excerpts provided," "According to the provided material," "The excerpts indicate," or similar — that framing reads as hedging. Only flag uncertainty plainly on the rare occasion the material genuinely doesn't cover the question — don't hedge routine, well-supported answers.`;

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
    max_tokens: 2048,
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

export interface DrawingImage {
  data: Buffer;
  mediaType: "image/png" | "image/jpeg";
}

const EXTRACTION_SYSTEM_PROMPT = `You are examining architectural drawing page(s) to identify elements worth checking against building Standards.
List every distinct, checkable element you can actually read off the drawing — each as its own numbered line, with a short description AND the specific value or detail shown (dimensions, materials, counts, distances, etc).
Only list what is actually legible or explicitly annotated on the drawing — never infer, assume, or guess a value that isn't shown. If a typical compliance-relevant detail (e.g. smoke alarm locations, stair dimensions, window sizes, wall setbacks, wet area waterproofing, balustrade heights, insulation) is not shown or annotated on this drawing, do not list it.
Respond with ONLY a numbered list, one item per line — no preamble, no headers, no summary.`;

/** Vision pass: looks at the rendered drawing page(s) and lists what's actually
 * checkable on them. Returns one string per list item, in the order Claude wrote
 * them — each becomes its own retrieval query in the caller. */
export async function extractDrawingItems(images: DrawingImage[]): Promise<string[]> {
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mediaType,
              data: img.data.toString("base64"),
            },
          })),
          {
            type: "text" as const,
            text: "List the checkable compliance elements visible on this drawing.",
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "";

  return text
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

export interface DrawingCheckItem {
  description: string;
  chunks: RetrievedChunk[];
}

const COMPLIANCE_SYSTEM_PROMPT = `You are Standards Assistant, helping an architect check a drawing against Australian Standards.
You'll be given a list of elements observed on an architectural drawing, each with excerpts retrieved from the uploaded Standards that may apply.
For each item: state plainly what the drawing shows, state what the applicable Standard requires — mentioning the specific clause number naturally in your own sentence (e.g. "clause 9.2.3 requires...") and naming any relevant diagram/table exactly as it appears in the excerpts (e.g. "Figure 9.2.3") so the application can display it automatically — then flag the item as one of: "Looks compliant", "Needs attention", or "Can't determine from the excerpts", with a short reason.
This is a screening tool, not a certified compliance assessment — never state a definitive pass or fail; phrase every finding as something to verify against the cited source, not a final ruling.
If no excerpt is actually relevant to an item, say so plainly and don't cite anything for it — never guess at a requirement that isn't in the excerpts.
Write conversationally, one short section per item — not a dense formal report.
You don't have image-display ability yourself, but the application does — never say you "can't display images"; just name the figure/table exactly and it will appear on its own.`;

/** Synthesis pass: turns the extracted items (each with its own retrieved excerpts)
 * into the final flagged report, following the same citation conventions as
 * askWithCitations so figure highlighting on the compliance page works unmodified. */
export async function buildComplianceReport(items: DrawingCheckItem[]): Promise<string> {
  const context = items
    .map((item, i) => {
      const excerpts = item.chunks
        .map((c) => {
          const ref = c.clauseLabel
            ? `clause ${c.clauseLabel}`
            : c.pageNumber
              ? `p.${c.pageNumber}`
              : "unknown location";
          return `[${c.documentTitle}, ${ref}]\n${c.content}`;
        })
        .join("\n\n");
      return `Item ${i + 1}: ${item.description}\n\nRelevant excerpts:\n${excerpts || "(none found)"}`;
    })
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: COMPLIANCE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: context }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
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
