"use client";

import { useEffect, useRef, useState } from "react";
import { COALA_GLOSSARY } from "../lib/coala-glossary";

/**
 * A subtle "(?)" button that reveals a verbatim CoALA paper quote for `id`.
 * Renders nothing if `id` is not in the glossary (keeps wiring forgiving).
 */
export function Why({ id }: { id: string }) {
  const entry = COALA_GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!entry) return null;

  const popoverId = `why-${id}`;

  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={`Why: ${id}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] leading-none text-slate-400 hover:border-indigo-500 hover:text-indigo-300"
      >
        ?
      </button>
      {open && (
        <span
          role="dialog"
          id={popoverId}
          aria-label={`Why: ${id}`}
          className="absolute left-1/2 top-6 z-50 w-72 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-left text-xs font-normal normal-case text-slate-200 shadow-xl"
        >
          <span className="block italic leading-relaxed">{`“${entry.quote}”`}</span>
          <span className="mt-2 block font-mono text-[10px] uppercase tracking-wide text-slate-500">
            CoALA paper · {entry.cite}
          </span>
        </span>
      )}
    </span>
  );
}
