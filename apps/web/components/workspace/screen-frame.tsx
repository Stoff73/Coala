"use client";

import type { ReactNode } from "react";

/** Shared shell for every detail screen: a back link + the screen body. */
export function ScreenFrame({
  breadcrumb,
  onBack,
  children,
}: {
  breadcrumb: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-slate-400 hover:text-indigo-300">
        ← {breadcrumb}
      </button>
      {children}
    </div>
  );
}
