import { getSupabaseServerClient } from "@/lib/supabase-server";
import { UploadForm } from "./UploadForm";
import { FiguresProgress } from "./FiguresProgress";
import { DocumentActions } from "./DocumentActions";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const supabase = getSupabaseServerClient();
  const { data: documents } = await supabase
    .from("documents")
    .select(
      "id, title, filename, status, error_message, created_at, figures_status, figures_done, figures_total"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-10 max-w-2xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">Upload a Standard</h1>
      <UploadForm />

      <div>
        <h2 className="font-heading text-lg font-medium mb-3">Documents</h2>
        {!documents || documents.length === 0 ? (
          <p className="text-offwhite/60 text-sm">No documents uploaded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded border border-cyan/20 px-4 py-2"
              >
                <DocumentActions documentId={doc.id} title={doc.title} />
                <div className="flex items-center gap-3">
                  {doc.status === "ready" && (
                    <FiguresProgress
                      documentId={doc.id}
                      initialStatus={doc.figures_status}
                      initialDone={doc.figures_done}
                      initialTotal={doc.figures_total}
                    />
                  )}
                  <span className="font-mono text-sm">
                    {doc.status === "ready" && (
                      <span className="text-cyan">ready</span>
                    )}
                    {doc.status === "processing" && (
                      <span className="text-offwhite/60">processing…</span>
                    )}
                    {doc.status === "error" && (
                      <span className="text-amber" title={doc.error_message ?? ""}>
                        error
                      </span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
