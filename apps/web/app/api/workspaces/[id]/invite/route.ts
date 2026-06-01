import { prisma } from "../../../../../lib/db";
import { fail, isValidEmail, ok, requireUser } from "../../../../../lib/api";
import { canManageWorkspace } from "../../../../../lib/workspaces";

export const runtime = "nodejs";

/** Pending invites for a workspace (owner/admin only). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await canManageWorkspace(params.id, user.id))) return fail("Not allowed.", 403);

  const invites = await prisma.workspaceInvite.findMany({
    where: { workspaceId: params.id },
    select: { email: true, role: true, createdAt: true },
  });
  return ok({ invites });
}

/**
 * Invite by email. If the person already has an account they're added immediately;
 * otherwise a pending invite is stored and claimed when they sign up / sign in.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await canManageWorkspace(params.id, user.id))) {
    return fail("Only owners/admins can invite.", 403);
  }

  const workspace = await prisma.workspace.findUnique({ where: { id: params.id } });
  if (!workspace) return fail("Workspace not found.", 404);
  if (workspace.personal) return fail("You can't invite people to a personal workspace.", 400);

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "admin" ? "admin" : "member";
  if (!isValidEmail(email)) return fail("A valid email is required.");

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const already = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: params.id, userId: existing.id } },
    });
    if (already) return ok({ status: "already-member" });
    await prisma.workspaceMember.create({
      data: { workspaceId: params.id, userId: existing.id, role },
    });
    return ok({ status: "added" }, 201);
  }

  await prisma.workspaceInvite.upsert({
    where: { workspaceId_email: { workspaceId: params.id, email } },
    update: { role, invitedById: user.id },
    create: { workspaceId: params.id, email, role, invitedById: user.id },
  });
  return ok({ status: "invited" }, 201);
}
