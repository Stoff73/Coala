"use client";

import { useEffect, useState } from "react";

export interface Workspace {
  id: string;
  name: string;
  personal: boolean;
  role: string;
}

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

interface Invite {
  email: string;
  role: string;
}

export function WorkspaceCard({ workspace, selfEmail }: { workspace: Workspace; selfEmail: string }) {
  const canManage =
    !workspace.personal && (workspace.role === "owner" || workspace.role === "admin");

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const m = await fetch(`/api/workspaces/${workspace.id}/members`).then((r) => r.json());
    setMembers(m.members ?? []);
    if (canManage) {
      const i = await fetch(`/api/workspaces/${workspace.id}/invite`).then((r) => r.json());
      setInvites(i.invites ?? []);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/workspaces/${workspace.id}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "Invite failed.");
      return;
    }
    setMsg(
      data.status === "added"
        ? `${email} added.`
        : data.status === "already-member"
          ? `${email} is already a member.`
          : `Invited ${email} — they'll join when they sign up.`,
    );
    setEmail("");
    load();
  }

  async function removeMember(userId: string) {
    await fetch(`/api/workspaces/${workspace.id}/members/${userId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">
            {workspace.name}
            {workspace.personal && <span className="ml-2 text-xs text-slate-500">personal</span>}
          </h3>
          <span className="text-xs uppercase tracking-wide text-slate-500">your role: {workspace.role}</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Members ({members.length})
        </div>
        <ul className="mt-1 divide-y divide-slate-800">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                {m.name ?? m.email}
                {m.email === selfEmail && <span className="text-slate-500"> (you)</span>}
                <span className="ml-2 text-xs text-slate-500">{m.role}</span>
              </span>
              {canManage && m.role !== "owner" && m.email !== selfEmail && (
                <button onClick={() => removeMember(m.userId)} className="text-xs text-slate-500 hover:text-red-400">
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canManage && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="invite by email"
              className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin")}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500">
              Invite
            </button>
          </form>
          {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}

          {invites.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending</div>
              <ul className="mt-1">
                {invites.map((i) => (
                  <li key={i.email} className="py-0.5 text-sm text-slate-400">
                    {i.email} <span className="text-xs text-slate-600">{i.role} · invited</span>
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
