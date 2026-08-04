"use client";

import { Fragment, cloneElement, isValidElement, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { CitationMark } from "@/app/ask/CitationMark";
import { ClausePagesPopover } from "@/app/ask/ClausePagesPopover";
import { splitTextWithCitations, type Citation } from "@/app/ask/citationMatching";

interface DocOption {
  id: string;
  title: string;
}

interface OfferedClause {
  documentId: string;
  documentTitle: string;
  clauseLabel: string;
  pageStart: number;
  pageEnd: number;
}

type MdProps<T> = T & { node?: unknown };

// Same recursion as the Ask page's citation scanner (see src/app/ask/page.tsx) — kept
// as a local copy rather than a shared import since it closes over this page's own
// `citations` state.
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

export default function CompliancePage() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [offeredClause, setOfferedClause] = useState<OfferedClause | null>(null);
  const [showOfferedClause, setShowOfferedClause] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "checking" | "error">("idle");
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
    if (!file) return;

    setErrorMessage("");
    setReport(null);
    setCitations([]);
    setOfferedClause(null);
    setShowOfferedClause(false);

    try {
      setStatus("uploading");

      const urlRes = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlJson.error ?? "Could not start upload.");

      const supabase = getSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("compliance-drawings")
        .uploadToSignedUrl(urlJson.storagePath, urlJson.token, file);
      if (uploadError) throw new Error(uploadError.message);

      setStatus("checking");

      const checkRes = await fetch("/api/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: urlJson.storagePath,
          filename: file.name,
          documentIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
        }),
      });
      const checkJson = await checkRes.json();
      if (!checkRes.ok) throw new Error(checkJson.error ?? "Compliance check failed.");

      setReport(checkJson.report);
      setCitations(checkJson.citations ?? []);
      setOfferedClause(checkJson.offeredClause ?? null);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const busy = status === "uploading" || status === "checking";

  const scopeLabel =
    selectedIds.size === 0
      ? "All documents"
      : selectedIds.size === 1
        ? allDocs.find((d) => selectedIds.has(d.id))?.title ?? "1 document"
        : `${selectedIds.size} documents`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-10 max-w-2xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold">Check a drawing</h1>
        <p className="rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
          This flags what to check and why, citing the source clause for each item — it
          is not a certified compliance assessment. Verify every finding against the
          cited source before relying on it.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Drawing (PDF, JPG, or PNG)
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-offwhite/80"
            required
          />
        </label>

        <div className="text-sm">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className="text-offwhite/60 hover:text-cyan font-mono"
          >
            Check against: {scopeLabel} {filterOpen ? "▴" : "▾"}
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
          disabled={busy || !file}
          className="self-start rounded bg-cyan px-4 py-2 font-medium text-navy disabled:opacity-50"
        >
          {status === "uploading" && "Uploading drawing..."}
          {status === "checking" && "Reading drawing & checking Standards..."}
          {(status === "idle" || status === "error") && "Check drawing"}
        </button>
        {status === "error" && (
          <p className="font-mono text-sm text-amber">Error — {errorMessage}</p>
        )}
      </form>

      {report && (
        <div className="flex flex-col gap-4 rounded border border-cyan/20 p-6">
          <ReactMarkdown components={markdownComponents}>{report}</ReactMarkdown>
          {offeredClause && (
            <div className="flex items-center justify-between gap-4 border-t border-cyan/20 pt-4">
              <span className="text-sm text-offwhite/60">
                Want to see the source page(s) for clause {offeredClause.clauseLabel}?
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
        <ClausePagesPopover
          documentId={offeredClause.documentId}
          documentTitle={offeredClause.documentTitle}
          clauseLabel={offeredClause.clauseLabel}
          pageStart={offeredClause.pageStart}
          pageEnd={offeredClause.pageEnd}
          onClose={() => setShowOfferedClause(false)}
        />
      )}
    </div>
  );
}
