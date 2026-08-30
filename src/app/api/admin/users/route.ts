import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, isAdmin } from "@/lib/supabase-session";

export const runtime = "nodejs";

export async function GET() {
  if (!isAdmin(await getSessionUser())) {
    return Response.json({ error: "Admin access required." }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();

  // Admin API paginates; fine for a small user base.
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    users.push(...data.users);
    if (data.users.length < 200) break;
    page++;
  }

  return Response.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role === "admin" ? "admin" : "viewer",
      products: Array.isArray(u.app_metadata?.products) ? u.app_metadata.products : [],
    })),
  });
}
