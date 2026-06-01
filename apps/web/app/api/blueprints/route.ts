import { prisma } from "../../../lib/db";
import { fail, ok, requireUser } from "../../../lib/api";
import { serializeAgent, userWorkspaceIds, validateAgent } from "../../../lib/blueprints";

export const runtime = "nodejs";

/** List blueprints the user owns or can see via a workspace. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const wsIds = await userWorkspaceIds(user.id);
  const blueprints = await prisma.blueprint.findMany({
    where: { OR: [{ ownerId: user.id }, { workspaceId: { in: wsIds } }] },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      version: true,
      ownerId: true,
      workspaceId: true,
      updatedAt: true,
    },
  });

  return ok({ blueprints: blueprints.map((b) => ({ ...b, mine: b.ownerId === user.id })) });
}

/** Create a new blueprint (version 1). */
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled agent";
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;

  let agentJson: string;
  try {
    agentJson = serializeAgent(validateAgent(body.agent));
  } catch (e) {
    return fail(`Invalid blueprint: ${e instanceof Error ? e.message : "parse error"}`);
  }

  // If a workspace is given, ensure membership.
  if (workspaceId && !(await userWorkspaceIds(user.id)).includes(workspaceId)) {
    return fail("You are not a member of that workspace.", 403);
  }

  const created = await prisma.blueprint.create({
    data: {
      name,
      ownerId: user.id,
      workspaceId,
      agent: agentJson,
      version: 1,
      versions: { create: { version: 1, agent: agentJson } },
    },
    select: { id: true, name: true, version: true, updatedAt: true },
  });

  return ok({ blueprint: created }, 201);
}
