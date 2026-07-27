"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded border border-cyan/20 p-6"
      >
        <h1 className="font-heading text-xl font-semibold">Sign in</h1>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-cyan/30 bg-transparent px-3 py-2 text-offwhite outline-none focus:border-cyan"
            required
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-cyan/30 bg-transparent px-3 py-2 text-offwhite outline-none focus:border-cyan"
            required
          />
        </label>
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded bg-cyan px-4 py-2 font-medium text-navy disabled:opacity-50"
        >
          {status === "loading" ? "Signing in..." : "Sign in"}
        </button>
        {status === "error" && (
          <p className="font-mono text-sm text-amber">Error — {errorMessage}</p>
        )}
      </form>
    </div>
  );
}
