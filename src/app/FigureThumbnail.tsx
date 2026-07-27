"use client";

import { useEffect, useState } from "react";

interface Props {
  url: string;
  label: string;
  className?: string;
  wrapperClassName?: string;
  children?: React.ReactNode;
}

export function FigureThumbnail({ url, label, className, wrapperClassName, children }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex cursor-zoom-in flex-col gap-1 text-left ${wrapperClassName ?? ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className={className} />
        {children}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/95 p-6"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 text-2xl leading-none text-offwhite/70 hover:text-cyan"
            aria-label="Close"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded border border-cyan/30 object-contain"
          />
        </div>
      )}
    </>
  );
}
