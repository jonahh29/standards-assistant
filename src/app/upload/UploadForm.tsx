"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function UploadForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title) return;

    setErrorMessage("");

    try {
      setStatus("uploading");

      const urlRes = await fetch("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlJson.error ?? "Could not start upload.");

      const supabase = getSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("standards-pdfs")
        .uploadToSignedUrl(urlJson.storagePath, urlJson.token, file, {
          contentType: "application/pdf",
        });
      if (uploadError) throw new Error(uploadError.message);

      setStatus("processing");

      const processRes = await fetch("/api/documents/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          filename: file.name,
          storagePath: urlJson.storagePath,
        }),
      });
      const processJson = await processRes.json();
      if (!processRes.ok) throw new Error(processJson.error ?? "Processing failed.");

      setStatus("idle");
      setTitle("");
      setFile(null);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  const busy = status === "uploading" || status === "processing";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded border border-cyan/20 p-6"
    >
      <label className="flex flex-col gap-1 text-sm">
        Document title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded border border-cyan/30 bg-transparent px-3 py-2 text-offwhite outline-none focus:border-cyan"
          placeholder="AS 1684.2 — Residential timber-framed construction"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        PDF file
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-offwhite/80"
          required
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-cyan px-4 py-2 font-medium text-navy disabled:opacity-50"
      >
        {status === "uploading" && "Uploading file..."}
        {status === "processing" && "Extracting & embedding text..."}
        {(status === "idle" || status === "error") && "Upload"}
      </button>
      {status === "error" && (
        <p className="font-mono text-sm text-amber">Error — {errorMessage}</p>
      )}
    </form>
  );
}
