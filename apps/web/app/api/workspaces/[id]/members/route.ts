import { prisma } from "../../../../../lib/db";
import { fail, ok, requireUser } from "../../../../../lib/api";
import { isMember } from "../../../../../lib/workspaces";

export const runtime = "nodejs";

/** List members of a workspace (any member may view). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await isMember(params.id, user.id))) return fail("Not a member of this workspace.", 403);

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: params.id },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return ok({
    members: members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
    })),
  });
}
