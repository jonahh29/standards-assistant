"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UploadForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title) return;

    setStatus("uploading");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("title", title);
    formData.append("file", file);

    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body: formData,
    });
    const json = await res.json();

    if (!res.ok) {
      setStatus("error");
      setErrorMessage(json.error ?? "Upload failed.");
      return;
    }

    setStatus("idle");
    setTitle("");
    setFile(null);
    router.refresh();
  }

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
        disabled={status === "uploading"}
        className="rounded bg-cyan px-4 py-2 font-medium text-navy disabled:opacity-50"
      >
        {status === "uploading" ? "Uploading & processing..." : "Upload"}
      </button>
      {status === "error" && (
        <p className="font-mono text-sm text-amber">Error — {errorMessage}</p>
      )}
    </form>
  );
}
