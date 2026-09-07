"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// A try/catch alone can't help if the underlying request just never settles at
// all (neither resolves nor rejects) — a genuinely stalled connection, which can
// happen for minutes on a marginal mobile signal without ever throwing a normal
// network error. Racing against a hard timeout guarantees the button always
// resolves to something visible either way, instead of waiting indefinitely.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

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

    // Wrapped in try/catch (any failure, including a mobile browser throwing
    // instead of returning a normal {error} — stricter cookie/storage handling
    // than desktop can do this) plus a hard timeout (in case the request just
    // stalls and never settles at all, which try/catch alone can't help with) —
    // between the two, this can never leave the button stuck on "Signing in..."
    // forever with no explanation.
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        15000
      );

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error && err.message === "TIMEOUT"
          ? "This is taking too long — check your connection and try again."
          : "Something went wrong signing in. Try again in a moment."
      );
    }
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
