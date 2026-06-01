import { parseAgent, type Agent } from "@coala/core";
import type { Blueprint } from "@prisma/client";
import { prisma } from "./db";

export async function userWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  return rows.map((r) => r.workspaceId);
}

export async function canView(bp: Blueprint, userId: string): Promise<boolean> {
  if (bp.ownerId === userId) return true;
  if (bp.workspaceId) return (await userWorkspaceIds(userId)).includes(bp.workspaceId);
  return false;
}

export async function canEdit(bp: Blueprint, userId: string): Promise<boolean> {
  if (bp.ownerId === userId) return true;
  if (bp.workspaceId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: bp.workspaceId, userId } },
    });
    return !!member && (member.role === "owner" || member.role === "admin");
  }
  return false;
}

export function serializeAgent(agent: Agent): string {
  return JSON.stringify(agent);
}

/** Validate + parse the stored JSON back into a typed Agent. */
export function deserializeAgent(text: string): Agent {
  return parseAgent(JSON.parse(text));
}

/** Validate an untrusted agent payload, throwing on invalid input. */
export function validateAgent(input: unknown): Agent {
  return parseAgent(input);
}
