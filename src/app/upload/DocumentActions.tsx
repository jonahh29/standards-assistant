"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  documentId: string;
  title: string;
}

export function DocumentActions({ documentId, title }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);

  async function saveRename() {
    const trimmed = value.trim();
    setEditing(false);
    if (!trimmed || trimmed === title) {
      setValue(title);
      return;
    }
    setBusy(true);
    await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    setBusy(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${title}"? This removes the file, its chunks, and its figures permanently.`)) {
      return;
    }
    setBusy(true);
    await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    router.refresh();
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={saveRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        className="rounded border border-cyan/30 bg-transparent px-2 py-0.5 text-offwhite outline-none focus:border-cyan"
      />
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Link href={`/documents/${documentId}`} className="hover:text-cyan">
        {title}
      </Link>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        className="font-mono text-xs text-offwhite/40 hover:text-cyan disabled:opacity-50"
        aria-label={`Rename ${title}`}
      >
        rename
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="font-mono text-xs text-offwhite/40 hover:text-amber disabled:opacity-50"
        aria-label={`Delete ${title}`}
      >
        delete
      </button>
    </span>
  );
}
