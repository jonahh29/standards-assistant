import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, isAdmin } from "@/lib/supabase-session";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(await getSessionUser())) {
    return Response.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const { products } = (await request.json()) as { products: unknown };

  if (!Array.isArray(products) || !products.every((p) => p === "residential" || p === "commercial")) {
    return Response.json({ error: "products must be an array of 'residential'/'commercial'." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // Merge into existing app_metadata so this never clobbers `role` (or anything
  // else already set there) — updateUserById replaces the whole object, not just
  // the keys you pass.
  const { data: existing, error: fetchError } = await supabase.auth.admin.getUserById(id);
  if (fetchError || !existing.user) {
    return Response.json({ error: fetchError?.message ?? "User not found." }, { status: 404 });
  }

  const { error } = await supabase.auth.admin.updateUserById(id, {
    app_metadata: { ...existing.user.app_metadata, products },
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
