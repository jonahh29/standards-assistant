import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/supabase-session";
import { generateFavouriteTitle } from "@/lib/anthropic";

export const runtime = "nodejs";

const HISTORY_LIMIT = 50;

interface IncomingFigure {
  storagePath: string;
  label: string | null;
}

interface IncomingCitation {
  documentTitle: string;
  pageNumber: number | null;
  pageEnd: number | null;
  clauseLabel: string | null;
  content: string;
  figures: IncomingFigure[];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("chat_history")
    .select("id, title, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ history: data });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const { question, answer, citations } = (await request.json()) as {
    question: string;
    answer: string;
    citations: IncomingCitation[];
  };

  if (!question || !answer) {
    return Response.json({ error: "question and answer are required." }, { status: 400 });
  }

  let title: string;
  try {
    title = await generateFavouriteTitle(question, answer);
  } catch {
    title = "";
  }
  if (!title) {
    title = question.length > 60 ? `${question.slice(0, 60)}…` : question;
  }

  // Store only what's needed to re-render later — drop the ephemeral signed url,
  // keep the storage path so a fresh one can be generated whenever this is opened.
  const storedCitations = (citations ?? []).map((c) => ({
    documentTitle: c.documentTitle,
    pageNumber: c.pageNumber,
    pageEnd: c.pageEnd,
    clauseLabel: c.clauseLabel,
    content: c.content,
    figures: (c.figures ?? []).map((f) => ({ storagePath: f.storagePath, label: f.label })),
  }));

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("chat_history")
    .insert({
      user_id: user.id,
      title,
      question,
      answer,
      citations: storedCitations,
    })
    .select("id, title")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
