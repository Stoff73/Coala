"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface BlueprintSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  mine: boolean;
}

export default function BlueprintsPage() {
  const [items, setItems] = useState<BlueprintSummary[] | null>(null);
  const [authed, setAuthed] = useState(true);

  async function load() {
    const res = await fetch("/api/blueprints");
    if (res.status === 401) {
      setAuthed(false);
      setItems([]);
      return;
    }
    const data = await res.json();
    setItems(data.blueprints ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this blueprint?")) return;
    await fetch(`/api/blueprints/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">My Blueprints</h1>

      {!authed ? (
        <p className="mt-4 text-slate-400">
          Please{" "}
          <Link href="/login" className="text-indigo-400 hover:underline">
            sign in
          </Link>{" "}
          to view your saved blueprints.
        </p>
      ) : items === null ? (
        <p className="mt-4 text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-slate-400">
          No saved blueprints yet.{" "}
          <Link href="/" className="text-indigo-400 hover:underline">
            Build one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-800 rounded-2xl border border-slate-800">
          {items.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <Link href={`/?id=${b.id}`} className="font-medium text-slate-100 hover:text-indigo-300">
                  {b.name}
                </Link>
                <div className="text-xs text-slate-500">
                  v{b.version} · updated {new Date(b.updatedAt).toLocaleString()}
                  {!b.mine && " · shared with you"}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Link href={`/?id=${b.id}`} className="text-slate-300 hover:text-indigo-300">
                  Open
                </Link>
                {b.mine && (
                  <button onClick={() => remove(b.id)} className="text-slate-500 hover:text-red-400">
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
