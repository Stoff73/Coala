import { prisma } from "../../../../../../lib/db";
import { fail, ok, requireUser } from "../../../../../../lib/api";
import { canManageWorkspace, membershipRole } from "../../../../../../lib/workspaces";

export const runtime = "nodejs";

/** Remove a member from a workspace (owner/admin only; cannot remove an owner). */
export async function DELETE(_req: Request, { params }: { params: { id: string; userId: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await canManageWorkspace(params.id, user.id))) {
    return fail("Only owners/admins can remove members.", 403);
  }

  const targetRole = await membershipRole(params.id, params.userId);
  if (!targetRole) return fail("That user is not a member.", 404);
  if (targetRole === "owner") return fail("Owners cannot be removed.", 400);

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: params.id, userId: params.userId } },
  });
  return ok({ ok: true });
}
