"use client";

import { Fragment, cloneElement, isValidElement, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { FavouritesSidebar } from "./FavouritesSidebar";
import { HistorySidebar } from "./HistorySidebar";
import { CitationMark } from "./CitationMark";
import { CitationPopover } from "./CitationPopover";
import { splitTextWithCitations, type Citation } from "./citationMatching";

interface DocOption {
  id: string;
  title: string;
}

type MdProps<T> = T & { node?: unknown };

// Recurses into nested inline elements (e.g. **bold** figure mentions, which markdown
// turns into a <strong> wrapping the text) so a figure is still detected and made
// clickable even when Claude formats it with emphasis instead of leaving it as plain
// text — e.g. a bolded sub-heading like "**Table 6.3.9a — matching coating...**".
function renderWithCitations(children: React.ReactNode, citations: Citation[]): React.ReactNode {
  const processNode = (node: React.ReactNode, key: string): React.ReactNode => {
    if (typeof node === "string") {
      const parts = splitTextWithCitations(node, citations);
      if (parts.length === 1 && typeof parts[0] === "string") return node;
      return parts.map((part, i) =>
        typeof part === "string" ? (
          <Fragment key={`${key}-${i}`}>{part}</Fragment>
        ) : (
          <CitationMark key={`${key}-${i}`} match={part} />
        )
      );
    }
    if (Array.isArray(node)) {
      return node.map((child, i) => processNode(child, `${key}-${i}`));
    }
    if (isValidElement<{ children?: React.ReactNode }>(node) && node.props.children) {
      return cloneElement(node, { key }, renderWithCitations(node.props.children, citations));
    }
    return node;
  };

  if (Array.isArray(children)) {
    return children.map((child, i) => processNode(child, `c${i}`));
  }
  return processNode(children, "c0");
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [offeredClause, setOfferedClause] = useState<Citation | null>(null);
  const [showOfferedClause, setShowOfferedClause] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [allDocs, setAllDocs] = useState<DocOption[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [favouriteStatus, setFavouriteStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [favouritesRefreshKey, setFavouritesRefreshKey] = useState(0);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase
      .from("documents")
      .select("id, title")
      .order("title")
      .then(({ data }) => setAllDocs(data ?? []));
  }, []);

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
    p: ({ node, children, ...props }: MdProps<React.ComponentProps<"p">>) => (
      <p className="leading-relaxed" {...props}>
        {renderWithCitations(children, citations)}
      </p>
    ),
    strong: ({ node, ...props }: MdProps<React.ComponentProps<"strong">>) => (
      <strong className="font-semibold" {...props} />
    ),
    ul: ({ node, ...props }: MdProps<React.ComponentProps<"ul">>) => (
      <ul className="list-disc pl-5 flex flex-col gap-1" {...props} />
    ),
    ol: ({ node, ...props }: MdProps<React.ComponentProps<"ol">>) => (
      <ol className="list-decimal pl-5 flex flex-col gap-1" {...props} />
    ),
    li: ({ node, children, ...props }: MdProps<React.ComponentProps<"li">>) => (
      <li className="leading-relaxed" {...props}>
        {renderWithCitations(children, citations)}
      </li>
    ),
    code: ({ node, ...props }: MdProps<React.ComponentProps<"code">>) => (
      <code className="font-mono text-sm text-cyan" {...props} />
    ),
  };

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
    setFavouriteStatus("idle");
    setOfferedClause(null);
    setShowOfferedClause(false);

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
    setOfferedClause(json.offeredClause ?? null);
    setStatus("idle");

    // Save to history in the background — doesn't block the answer from showing,
    // and a failure here shouldn't interrupt the user's flow.
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer: json.answer, citations: json.citations ?? [] }),
    }).then((res) => {
      if (res.ok) setHistoryRefreshKey((k) => k + 1);
    });
  }

  async function handleFavourite() {
    if (!answer) return;
    setFavouriteStatus("saving");
    const res = await fetch("/api/favourites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, citations }),
    });
    setFavouriteStatus(res.ok ? "saved" : "idle");
    if (res.ok) setFavouritesRefreshKey((k) => k + 1);
  }

  function handleLoadSaved(
    data: { question: string; answer: string; citations: unknown[] },
    alreadyFavourited: boolean
  ) {
    setQuestion(data.question);
    setAnswer(data.answer);
    setCitations(data.citations as Citation[]);
    setOfferedClause(null);
    setShowOfferedClause(false);
    setStatus("idle");
    setFavouriteStatus(alreadyFavourited ? "saved" : "idle");
  }

  const scopeLabel =
    selectedIds.size === 0
      ? "All documents"
      : selectedIds.size === 1
        ? allDocs.find((d) => selectedIds.has(d.id))?.title ?? "1 document"
        : `${selectedIds.size} documents`;

  return (
    <div className="flex flex-1">
      <FavouritesSidebar
        refreshKey={favouritesRefreshKey}
        onSelect={(data) => handleLoadSaved(data, true)}
      />

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
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-1 flex-col gap-2">
                <ReactMarkdown components={markdownComponents}>{answer}</ReactMarkdown>
              </div>
              <button
                type="button"
                onClick={handleFavourite}
                disabled={favouriteStatus !== "idle"}
                className="shrink-0 font-mono text-sm text-offwhite/60 hover:text-cyan disabled:opacity-60"
              >
                {favouriteStatus === "saved"
                  ? "★ Favourited"
                  : favouriteStatus === "saving"
                    ? "Saving…"
                    : "☆ Favourite"}
              </button>
            </div>
            {offeredClause && (
              <div className="flex items-center justify-between gap-4 border-t border-cyan/20 pt-4">
                <span className="text-sm text-offwhite/60">
                  Want the full text of clause {offeredClause.clauseLabel}?
                </span>
                <button
                  type="button"
                  onClick={() => setShowOfferedClause(true)}
                  className="shrink-0 rounded border border-cyan/40 px-3 py-1.5 font-mono text-sm text-cyan hover:bg-cyan/10"
                >
                  Yes, show me
                </button>
              </div>
            )}
          </div>
        )}
        {showOfferedClause && offeredClause && (
          <CitationPopover citation={offeredClause} onClose={() => setShowOfferedClause(false)} />
        )}
      </div>

      <HistorySidebar
        refreshKey={historyRefreshKey}
        onSelect={(data) => handleLoadSaved(data, false)}
      />
    </div>
  );
}
