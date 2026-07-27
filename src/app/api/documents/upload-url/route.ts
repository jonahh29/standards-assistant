import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, isAdmin } from "@/lib/supabase-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdmin(await getSessionUser())) {
    return Response.json({ error: "Admin access required." }, { status: 403 });
  }

  const { filename } = await request.json();

  if (!filename || typeof filename !== "string") {
    return Response.json({ error: "A filename is required." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const storagePath = `${Date.now()}-${filename}`;

  const { data, error } = await supabase.storage
    .from("standards-pdfs")
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
