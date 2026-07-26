import { getSupabaseServerClient } from "@/lib/supabase-server";

export default async function Home() {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.storage.listBuckets();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="font-heading text-3xl font-semibold">
        Standards Assistant
      </h1>
      <p className="text-lg text-offwhite/70">
        Cited answers from your Australian Standards documents.
      </p>
      <p className="font-mono text-sm">
        Supabase connection:{" "}
        {error ? (
          <span className="font-medium text-amber">
            Error — {error.message}
          </span>
        ) : (
          <span className="font-medium text-cyan">Connected ✓</span>
        )}
      </p>
    </div>
  );
}
