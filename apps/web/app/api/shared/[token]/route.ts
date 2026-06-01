import { prisma } from "../../../../lib/db";
import { fail, ok } from "../../../../lib/api";
import { deserializeAgent } from "../../../../lib/blueprints";

export const runtime = "nodejs";

/** Resolve a share link to its blueprint. Link-based access — no login required. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const share = await prisma.blueprintShare.findUnique({
    where: { token: params.token },
    include: { blueprint: true },
  });
  if (!share) return fail("Share link not found or revoked.", 404);

  return ok({
    role: share.role,
    blueprint: {
      id: share.blueprint.id,
      name: share.blueprint.name,
      version: share.blueprint.version,
      agent: deserializeAgent(share.blueprint.agent),
    },
  });
}
