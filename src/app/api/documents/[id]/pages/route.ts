import { getDocumentProxy } from "unpdf";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { ensurePdfjsModule, renderFigurePage } from "@/lib/figures";
import { getSessionUser } from "@/lib/supabase-session";

export const runtime = "nodejs";
export const maxDuration = 60;

// A runaway page range shouldn't be able to force this one request to render dozens
// of pages and blow the function's time budget.
const MAX_PAGES = 15;

const cachePath = (documentId: string, pageNumber: number) =>
  `${documentId}/clause-page-${pageNumber}.png`;

/** Renders (or reuses a cached render of) the literal PDF page(s) for a given range —
 * used by "show me the full clause" so it displays the actual page image rather than
 * extracted/reassembled text. Available to any signed-in user, matching /api/ask's
 * own access level (not admin-only, unlike the upload-time figure processing routes). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const start = Number(url.searchParams.get("start"));
  const end = Number(url.searchParams.get("end"));

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return Response.json({ error: "Invalid page range." }, { status: 400 });
  }
  if (end - start + 1 > MAX_PAGES) {
    return Response.json({ error: "Page range too large." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: document } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", id)
    .single();

  if (!document) return Response.json({ error: "Document not found." }, { status: 404 });

  const pageNumbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const urlByPage = new Map<number, string>();

  await Promise.all(
    pageNumbers.map(async (p) => {
      const { data: signed } = await supabase.storage
        .from("standards-figures")
        .createSignedUrl(cachePath(id, p), 3600);
      if (signed?.signedUrl) urlByPage.set(p, signed.signedUrl);
    })
  );

  const missing = pageNumbers.filter((p) => !urlByPage.has(p));

  if (missing.length > 0) {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("standards-pdfs")
      .download(document.storage_path);

    if (downloadError || !fileBlob) {
      return Response.json(
        { error: downloadError?.message ?? "Could not load the document file." },
        { status: 500 }
      );
    }

    await ensurePdfjsModule();
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);

    for (const p of missing) {
      const rendered = await renderFigurePage(pdf, p, []);
      const path = cachePath(id, p);

      const { error: uploadError } = await supabase.storage
        .from("standards-figures")
        .upload(path, rendered.png, { contentType: "image/png", upsert: true });
      if (uploadError) continue;

      const { data: signed } = await supabase.storage
        .from("standards-figures")
        .createSignedUrl(path, 3600);
      if (signed?.signedUrl) urlByPage.set(p, signed.signedUrl);
    }
  }

  const pages = pageNumbers
    .map((p) => ({ pageNumber: p, url: urlByPage.get(p) ?? null }))
    .filter((p): p is { pageNumber: number; url: string } => p.url !== null);

  return Response.json({ pages });
}
