import type { User } from "@prisma/client";
import { prisma } from "./db";

export async function membershipRole(workspaceId: string, userId: string): Promise<string | null> {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  return m?.role ?? null;
}

export async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  return (await membershipRole(workspaceId, userId)) !== null;
}

export async function canManageWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const role = await membershipRole(workspaceId, userId);
  return role === "owner" || role === "admin";
}

/** Turn any pending invites for this user's email into memberships (run on login/register). */
export async function acceptPendingInvites(user: User): Promise<void> {
  const invites = await prisma.workspaceInvite.findMany({ where: { email: user.email } });
  for (const inv of invites) {
    await prisma.$transaction([
      prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } },
        update: {},
        create: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role },
      }),
      prisma.workspaceInvite.delete({ where: { id: inv.id } }),
    ]);
  }
}
