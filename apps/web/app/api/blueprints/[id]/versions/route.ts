import { prisma } from "../../../../../lib/db";
import { fail, ok, requireUser } from "../../../../../lib/api";
import { canView } from "../../../../../lib/blueprints";

export const runtime = "nodejs";

/** Linear version history for a blueprint (newest first). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const bp = await prisma.blueprint.findUnique({ where: { id: params.id } });
  if (!bp) return fail("Blueprint not found.", 404);
  if (!(await canView(bp, user.id))) return fail("You don't have access to this blueprint.", 403);

  const versions = await prisma.blueprintVersion.findMany({
    where: { blueprintId: bp.id },
    orderBy: { version: "desc" },
    select: { version: true, createdAt: true },
  });
  return ok({ versions });
}
