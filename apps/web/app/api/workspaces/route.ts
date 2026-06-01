import { prisma } from "../../../lib/db";
import { fail, ok, requireUser } from "../../../lib/api";

export const runtime = "nodejs";

/** Workspaces the user belongs to (with their role). */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { workspace: { createdAt: "asc" } },
  });

  return ok({
    workspaces: memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      personal: m.workspace.personal,
      role: m.role,
    })),
  });
}

/** Create a new (team) workspace, owned by the current user. */
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
  if (!name) return fail("A workspace name is required.");

  const ws = await prisma.workspace.create({
    data: {
      name,
      personal: false,
      members: { create: { userId: user.id, role: "owner" } },
    },
    select: { id: true, name: true, personal: true },
  });
  return ok({ workspace: { ...ws, role: "owner" } }, 201);
}
