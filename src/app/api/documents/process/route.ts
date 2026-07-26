import { getDocumentProxy, extractText } from "unpdf";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { chunkPages } from "@/lib/chunk";
import { embedTexts } from "@/lib/voyage";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMBED_BATCH_SIZE = 20;

export async function POST(request: Request) {
  const { title, filename, storagePath } = await request.json();

  if (!title || !filename || !storagePath) {
    return Response.json(
      { error: "title, filename, and storagePath are required." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  const { data: document, error: insertError } = await supabase
    .from("documents")
    .insert({
      title,
      filename,
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
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("standards-pdfs")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message ?? "Could not download uploaded file.");
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
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
