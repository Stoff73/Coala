"use client";

import Link from "next/link";
import { logout, useMe } from "../lib/useMe";

export function Nav() {
  const me = useMe();

  return (
    <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-5">
          <Link href="/" className="font-semibold text-slate-100">
            CoALA<span className="text-indigo-400"> Builder</span>
          </Link>
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
            Builder
          </Link>
          {me && (
            <>
              <Link href="/blueprints" className="text-sm text-slate-400 hover:text-slate-200">
                My Blueprints
              </Link>
              <Link href="/workspaces" className="text-sm text-slate-400 hover:text-slate-200">
                Workspaces
              </Link>
            </>
          )}
        </div>

        <div className="text-sm">
          {me === undefined ? (
            <span className="text-slate-600">…</span>
          ) : me ? (
            <div className="flex items-center gap-3">
              <span className="text-slate-400">{me.name ?? me.email}</span>
              <button onClick={() => logout()} className="text-slate-400 hover:text-red-400">
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/login" className="text-slate-300 hover:text-white">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
