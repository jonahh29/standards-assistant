import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/supabase-session";

export const runtime = "nodejs";

// Any signed-in user can run a compliance check, matching /api/ask's own access
// level — unlike document uploads (admin-only), this doesn't add anything to the
// searchable corpus, so it doesn't need the stricter guard.
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const { filename } = await request.json();

  if (!filename || typeof filename !== "string") {
    return Response.json({ error: "A filename is required." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const storagePath = `${Date.now()}-${filename}`;

  const { data, error } = await supabase.storage
    .from("compliance-drawings")
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return Response.json(
      { error: error?.message ?? "Could not create upload URL." },
      { status: 500 }
    );
  }

  return Response.json({
    storagePath,
    token: data.token,
  });
}
