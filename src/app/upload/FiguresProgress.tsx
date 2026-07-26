"use client";

import { useEffect, useState } from "react";

interface Props {
  documentId: string;
  initialStatus: string;
  initialDone: number;
  initialTotal: number;
}

export function FiguresProgress({
  documentId,
  initialStatus,
  initialDone,
  initialTotal,
}: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [done, setDone] = useState(initialDone);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialStatus === "done") return;
    let cancelled = false;

    async function runLoop() {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/documents/${documentId}/figures-batch`, {
            method: "POST",
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Batch failed.");

          if (cancelled) return;
          setDone(json.doneCount);
          setTotal(json.total);

          if (json.done) {
            setStatus("done");
            return;
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
          }
          return;
        }
      }
    }

    runLoop();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  if (status === "done") return null;

  return (
    <span className="font-mono text-xs text-offwhite/60">
      {error ? (
        <span className="text-amber">figures paused — reload to resume</span>
      ) : (
        `extracting figures: ${done}/${total}`
      )}
    </span>
  );
}
