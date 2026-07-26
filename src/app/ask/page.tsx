"use client";

import { useState } from "react";

interface Figure {
  url: string;
  label: string | null;
}

interface Citation {
  documentTitle: string;
  pageNumber: number | null;
  clauseLabel: string | null;
  figures: Figure[];
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setStatus("loading");
    setAnswer(null);
    setErrorMessage("");

    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
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
          <p className="whitespace-pre-wrap leading-relaxed">{answer}</p>
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
