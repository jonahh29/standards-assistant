import { getSupabaseServerClient } from "@/lib/supabase-server";

export default async function Home() {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.storage.listBuckets();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
        Standards Assistant
      </h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">Hello world 🎉</p>
      <p className="text-base">
        Supabase connection:{" "}
        {error ? (
          <span className="font-medium text-red-600">
            Error — {error.message}
          </span>
        ) : (
          <span className="font-medium text-green-600">Connected ✓</span>
        )}
      </p>
    </div>
  );
}
