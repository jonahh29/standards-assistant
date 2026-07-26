"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

interface Figure {
  url: string;
  label: string | null;
}

interface Citation {
  documentTitle: string;
  pageNumber: number | null;
  pageEnd: number | null;
  clauseLabel: string | null;
  figures: Figure[];
}

interface DocOption {
  id: string;
  title: string;
}

type MdProps<T> = T & { node?: unknown };

const markdownComponents = {
  h1: ({ node, ...props }: MdProps<React.ComponentProps<"h1">>) => (
    <h1 className="font-heading text-xl font-semibold mt-4 first:mt-0" {...props} />
  ),
  h2: ({ node, ...props }: MdProps<React.ComponentProps<"h2">>) => (
    <h2 className="font-heading text-lg font-semibold mt-4 first:mt-0" {...props} />
  ),
  h3: ({ node, ...props }: MdProps<React.ComponentProps<"h3">>) => (
    <h3 className="font-heading text-base font-semibold mt-3 first:mt-0" {...props} />
  ),
  p: ({ node, ...props }: MdProps<React.ComponentProps<"p">>) => (
    <p className="leading-relaxed" {...props} />
  ),
  strong: ({ node, ...props }: MdProps<React.ComponentProps<"strong">>) => (
    <strong className="font-semibold text-cyan" {...props} />
  ),
  ul: ({ node, ...props }: MdProps<React.ComponentProps<"ul">>) => (
    <ul className="list-disc pl-5 flex flex-col gap-1" {...props} />
  ),
  ol: ({ node, ...props }: MdProps<React.ComponentProps<"ol">>) => (
    <ol className="list-decimal pl-5 flex flex-col gap-1" {...props} />
  ),
  li: ({ node, ...props }: MdProps<React.ComponentProps<"li">>) => (
    <li className="leading-relaxed" {...props} />
  ),
  code: ({ node, ...props }: MdProps<React.ComponentProps<"code">>) => (
    <code className="font-mono text-sm text-cyan" {...props} />
  ),
};

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [allDocs, setAllDocs] = useState<DocOption[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase
      .from("documents")
      .select("id, title")
      .order("title")
      .then(({ data }) => setAllDocs(data ?? []));
  }, []);

  function toggleDoc(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setStatus("loading");
    setAnswer(null);
    setErrorMessage("");

    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        documentIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
      }),
    });
    const json = await res.json();

    if (!res.ok) {
      setStatus("error");
      setErrorMessage(json.error ?? "Something went wrong.");
      return;
    }

    setAnswer(json.answer);
    setCitations(json.citations ?? []);
    setStatus("idle");
  }

  const scopeLabel =
    selectedIds.size === 0
      ? "All documents"
      : selectedIds.size === 1
        ? allDocs.find((d) => selectedIds.has(d.id))?.title ?? "1 document"
        : `${selectedIds.size} documents`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-10 max-w-2xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">Ask a question</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Where must smoke alarms be installed in a residential corridor?"
          rows={3}
          className="rounded border border-cyan/30 bg-transparent px-3 py-2 text-offwhite outline-none focus:border-cyan"
          required
        />

        <div className="text-sm">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className="text-offwhite/60 hover:text-cyan font-mono"
          >
            Search in: {scopeLabel} {filterOpen ? "▴" : "▾"}
          </button>
          {filterOpen && (
            <div className="mt-2 flex flex-col gap-1 rounded border border-cyan/20 p-3 max-h-48 overflow-y-auto">
              {allDocs.length === 0 && (
                <span className="text-offwhite/40 text-xs">No documents uploaded yet.</span>
              )}
              {allDocs.map((doc) => (
                <label key={doc.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => toggleDoc(doc.id)}
                  />
                  {doc.title}
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={status === "loading"}
          className="self-start rounded bg-cyan px-4 py-2 font-medium text-navy disabled:opacity-50"
        >
          {status === "loading" ? "Searching..." : "Ask"}
        </button>
        {status === "error" && (
          <p className="font-mono text-sm text-amber">Error — {errorMessage}</p>
        )}
      </form>

      {answer && (
        <div className="flex flex-col gap-4 rounded border border-cyan/20 p-6">
          <div className="flex flex-col gap-2">
            <ReactMarkdown components={markdownComponents}>{answer}</ReactMarkdown>
          </div>
          {citations.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-cyan/20 pt-4">
              <span className="text-sm text-offwhite/60">Sources</span>
              <ul className="flex flex-col gap-3">
                {citations.map((c, i) => (
                  <li key={i} className="flex flex-col gap-2">
                    <span className="font-mono text-sm text-cyan">
                      {c.documentTitle}
                      {c.clauseLabel
                        ? ` — clause ${c.clauseLabel}`
                        : c.pageNumber
                          ? ` — p.${c.pageNumber}`
                          : ""}
                    </span>
                    {c.figures.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {c.figures.map((fig, j) => (
                          <a key={j} href={fig.url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={fig.url}
                              alt={fig.label ?? `Figure from ${c.documentTitle}`}
                              className="h-24 w-auto rounded border border-cyan/30"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
