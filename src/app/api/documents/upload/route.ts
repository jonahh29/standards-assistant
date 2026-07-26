import { getDocumentProxy, extractText } from "unpdf";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { chunkPages } from "@/lib/chunk";
import { embedTexts } from "@/lib/voyage";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMBED_BATCH_SIZE = 20;

export async function POST(request: Request) {
  const supabase = getSupabaseServerClient();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null)?.trim();

  if (!file || !title) {
    return Response.json(
      { error: "Both a title and a PDF file are required." },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const storagePath = `${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("standards-pdfs")
    .upload(storagePath, bytes, { contentType: "application/pdf" });

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: document, error: insertError } = await supabase
    .from("documents")
    .insert({
      title,
      filename: file.name,
      storage_path: storagePath,
      status: "processing",
    })
    .select()
    .single();

  if (insertError || !document) {
    return Response.json(
      { error: insertError?.message ?? "Failed to create document record." },
      { status: 500 }
    );
  }

  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const chunks = chunkPages(pages);

    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const embeddings = await embedTexts(batch.map((c) => c.content));

      const rows = batch.map((chunk, j) => ({
        document_id: document.id,
        chunk_index: i + j,
        page_number: chunk.pageNumber,
        clause_label: chunk.clauseLabel,
        content: chunk.content,
        embedding: embeddings[j],
      }));

      const { error: chunkError } = await supabase
        .from("document_chunks")
        .insert(rows);

      if (chunkError) throw new Error(chunkError.message);
    }

    await supabase
      .from("documents")
      .update({ status: "ready" })
      .eq("id", document.id);

    return Response.json({ id: document.id, status: "ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed.";
    await supabase
      .from("documents")
      .update({ status: "error", error_message: message })
      .eq("id", document.id);

    return Response.json({ error: message }, { status: 500 });
  }
}
