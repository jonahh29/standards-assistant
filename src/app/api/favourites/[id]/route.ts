import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/supabase-session";

export const runtime = "nodejs";

interface StoredFigure {
  storagePath: string;
  label: string | null;
}

interface StoredCitation {
  documentTitle: string;
  pageNumber: number | null;
  pageEnd: number | null;
  clauseLabel: string | null;
  figures: StoredFigure[];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("favourites")
    .select("question, answer, citations")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return Response.json({ error: "Favourite not found." }, { status: 404 });
  }

  const storedCitations = (data.citations ?? []) as StoredCitation[];

  const citations = await Promise.all(
    storedCitations.map(async (c) => {
      const figures = await Promise.all(
        c.figures.map(async (fig) => {
          const { data: signed } = await supabase.storage
            .from("standards-figures")
            .createSignedUrl(fig.storagePath, 3600);
          return { url: signed?.signedUrl ?? null, label: fig.label, storagePath: fig.storagePath };
        })
      );
      return { ...c, figures: figures.filter((f) => f.url) };
    })
  );

  return Response.json({ question: data.question, answer: data.answer, citations });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("favourites")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
