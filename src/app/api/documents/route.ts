import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, getAllowedProducts } from "@/lib/supabase-session";

export const runtime = "nodejs";

/** Documents the caller is actually allowed to see, scoped to their product access
 * (residential/commercial). Replaces having the Ask page query `documents` directly
 * via the browser Supabase client — that path goes through RLS's blanket
 * "authenticated can read" policy, which has no product awareness at all, so every
 * signed-in user could otherwise list every document regardless of access. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const allowedProducts = getAllowedProducts(user);
  if (allowedProducts.length === 0) return Response.json({ documents: [] });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, product")
    .in("product", allowedProducts)
    .order("title");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ documents: data });
}
