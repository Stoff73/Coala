"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspaceCard, type Workspace } from "../../components/workspace-card";
import { useMe } from "../../lib/useMe";

export default function WorkspacesPage() {
  const me = useMe();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [newName, setNewName] = useState("");

  async function load() {
    const data = await fetch("/api/workspaces").then((r) => r.json());
    setWorkspaces(data.workspaces ?? []);
  }

  useEffect(() => {
    if (me) load();
    else if (me === null) setWorkspaces([]);
  }, [me]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    setNewName("");
    load();
  }

  if (me === null) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold">Workspaces</h1>
        <p className="mt-4 text-slate-400">
          Please{" "}
          <Link href="/login" className="text-indigo-400 hover:underline">
            sign in
          </Link>{" "}
          to manage workspaces.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workspaces</h1>
        <form onSubmit={create} className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New workspace name"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
          />
          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
            Create
          </button>
        </form>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Share blueprints with a team. Invite people by email — they join when they sign up.
      </p>

      <div className="mt-6 space-y-4">
        {workspaces === null ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          workspaces.map((w) => (
            <WorkspaceCard key={w.id} workspace={w} selfEmail={me?.email ?? ""} />
          ))
        )}
      </div>
    </main>
  );
}
