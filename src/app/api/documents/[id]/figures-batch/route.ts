import { getDocumentProxy } from "unpdf";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { ensurePdfjsModule, renderFigurePage, type PageLabels } from "@/lib/figures";
import { getSessionUser, isAdmin } from "@/lib/supabase-session";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 15;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(await getSessionUser())) {
    return Response.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: document, error: fetchError } = await supabase
    .from("documents")
    .select("id, storage_path, figures_status, figure_queue, figures_done, figures_total")
    .eq("id", id)
    .single();

  if (fetchError || !document) {
    return Response.json({ error: fetchError?.message ?? "Document not found." }, { status: 404 });
  }

  const queue = (document.figure_queue as PageLabels[]) ?? [];

  if (document.figures_status === "done" || queue.length === 0) {
    return Response.json({
      done: true,
      doneCount: document.figures_done,
      total: document.figures_total,
    });
  }

  const batch = queue.slice(0, BATCH_SIZE);
  const remaining = queue.slice(BATCH_SIZE);

  await ensurePdfjsModule();

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("standards-pdfs")
    .download(document.storage_path);

  if (downloadError || !fileBlob) {
    return Response.json(
      { error: downloadError?.message ?? "Could not download file." },
      { status: 500 }
    );
  }

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const pdf = await getDocumentProxy(bytes);

  for (const item of batch) {
    const figure = await renderFigurePage(pdf, item.page, item.labels);
    const figurePath = `${document.id}/${figure.pageNumber}-0.png`;

    const { error: uploadError } = await supabase.storage
      .from("standards-figures")
      .upload(figurePath, figure.png, { contentType: "image/png" });

    if (uploadError) {
      return Response.json({ error: uploadError.message }, { status: 500 });
    }

    const { error: insertError } = await supabase.from("document_figures").insert({
      document_id: document.id,
      page_number: figure.pageNumber,
      storage_path: figurePath,
      label: figure.label,
      width: figure.width,
      height: figure.height,
    });

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }
  }

  const doneCount = document.figures_done + batch.length;
  const done = remaining.length === 0;

  await supabase
    .from("documents")
    .update({
      figure_queue: remaining,
      figures_done: doneCount,
      figures_status: done ? "done" : "processing",
    })
    .eq("id", document.id);

  return Response.json({ done, doneCount, total: document.figures_total });
}
