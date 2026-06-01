import { prisma } from "../../../../lib/db";
import { fail, ok, requireUser } from "../../../../lib/api";
import { canEdit, canView, deserializeAgent, serializeAgent, validateAgent, userWorkspaceIds } from "../../../../lib/blueprints";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const bp = await prisma.blueprint.findUnique({ where: { id: params.id } });
  if (!bp) return fail("Blueprint not found.", 404);
  if (!(await canView(bp, user.id))) return fail("You don't have access to this blueprint.", 403);

  return ok({
    blueprint: {
      id: bp.id,
      name: bp.name,
      version: bp.version,
      agent: deserializeAgent(bp.agent),
      ownerId: bp.ownerId,
      workspaceId: bp.workspaceId,
      updatedAt: bp.updatedAt,
      canEdit: await canEdit(bp, user.id),
    },
  });
}

/** Update a blueprint; bumps version and appends a linear history snapshot. */
export async function PUT(request: Request, { params }: Params) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const bp = await prisma.blueprint.findUnique({ where: { id: params.id } });
  if (!bp) return fail("Blueprint not found.", 404);
  if (!(await canEdit(bp, user.id))) return fail("You can't edit this blueprint.", 403);

  const body = await request.json().catch(() => ({}));
  let agentJson: string;
  try {
    agentJson = serializeAgent(validateAgent(body.agent));
  } catch (e) {
    return fail(`Invalid blueprint: ${e instanceof Error ? e.message : "parse error"}`);
  }

  // Optional workspace move (owner only; must be a member of the target, or null = personal).
  let workspaceId = bp.workspaceId;
  if ("workspaceId" in body) {
    if (bp.ownerId !== user.id) return fail("Only the owner can move this blueprint.", 403);
    const target = body.workspaceId === null ? null : String(body.workspaceId);
    if (target && !(await userWorkspaceIds(user.id)).includes(target)) {
      return fail("You are not a member of that workspace.", 403);
    }
    workspaceId = target;
  }

  const nextVersion = bp.version + 1;
  const updated = await prisma.blueprint.update({
    where: { id: bp.id },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : bp.name,
      agent: agentJson,
      workspaceId,
      version: nextVersion,
      versions: { create: { version: nextVersion, agent: agentJson } },
    },
    select: { id: true, name: true, version: true, updatedAt: true },
  });

  return ok({ blueprint: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const bp = await prisma.blueprint.findUnique({ where: { id: params.id } });
  if (!bp) return fail("Blueprint not found.", 404);
  if (bp.ownerId !== user.id) return fail("Only the owner can delete this blueprint.", 403);

  await prisma.blueprint.delete({ where: { id: bp.id } });
  return ok({ ok: true });
}
