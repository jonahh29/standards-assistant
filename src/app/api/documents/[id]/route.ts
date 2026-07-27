import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, isAdmin } from "@/lib/supabase-session";

export const runtime = "nodejs";

export async function DELETE(
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
    .select("storage_path")
    .eq("id", id)
    .single();

  if (fetchError || !document) {
    return Response.json({ error: fetchError?.message ?? "Document not found." }, { status: 404 });
  }

  const { data: figures } = await supabase
    .from("document_figures")
    .select("storage_path")
    .eq("document_id", id);

  if (figures?.length) {
    await supabase.storage
      .from("standards-figures")
      .remove(figures.map((f) => f.storage_path));
  }

  await supabase.storage.from("standards-pdfs").remove([document.storage_path]);

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", id);
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(await getSessionUser())) {
    return Response.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const { title } = await request.json();

  if (!title || typeof title !== "string") {
    return Response.json({ error: "A title is required." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("documents").update({ title }).eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
