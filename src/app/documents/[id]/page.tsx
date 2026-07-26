import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: document } = await supabase
    .from("documents")
    .select("id, title, status")
    .eq("id", id)
    .single();

  const { data: figureRows } = await supabase
    .from("document_figures")
    .select("storage_path, label, page_number")
    .eq("document_id", id)
    .order("page_number");

  const figures = await Promise.all(
    (figureRows ?? []).map(async (row) => {
      const { data: signed } = await supabase.storage
        .from("standards-figures")
        .createSignedUrl(row.storage_path, 3600);
      return {
        url: signed?.signedUrl ?? null,
        label: row.label,
        pageNumber: row.page_number,
      };
    })
  );

  if (!document) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-6 py-10 max-w-3xl mx-auto w-full">
        <p className="text-offwhite/60">Document not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-10 max-w-3xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">{document.title}</h1>

      {figures.length === 0 ? (
        <p className="text-offwhite/60 text-sm">
          No figures were extracted from this document.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {figures.map((fig, i) => (
            <a
              key={i}
              href={fig.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-1 rounded border border-cyan/20 p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fig.url ?? undefined}
                alt={fig.label ?? `Figure on page ${fig.pageNumber}`}
                className="w-full rounded"
              />
              <span className="font-mono text-xs text-offwhite/60">
                {fig.label ?? `p.${fig.pageNumber}`}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
