import { randomBytes } from "node:crypto";
import { prisma } from "../../../../../lib/db";
import { fail, ok, requireUser } from "../../../../../lib/api";
import { canEdit } from "../../../../../lib/blueprints";

export const runtime = "nodejs";

/** List existing share links (editors only). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const bp = await prisma.blueprint.findUnique({ where: { id: params.id } });
  if (!bp) return fail("Blueprint not found.", 404);
  if (!(await canEdit(bp, user.id))) return fail("You can't manage sharing for this blueprint.", 403);

  const shares = await prisma.blueprintShare.findMany({
    where: { blueprintId: bp.id },
    select: { token: true, role: true, createdAt: true },
  });
  return ok({ shares });
}

/** Create a share link with a view/edit role. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const bp = await prisma.blueprint.findUnique({ where: { id: params.id } });
  if (!bp) return fail("Blueprint not found.", 404);
  if (!(await canEdit(bp, user.id))) return fail("You can't share this blueprint.", 403);

  const body = await request.json().catch(() => ({}));
  const role = body.role === "edit" ? "edit" : "view";
  const token = randomBytes(16).toString("hex");

  const share = await prisma.blueprintShare.create({
    data: { blueprintId: bp.id, token, role },
    select: { token: true, role: true },
  });
  return ok({ share }, 201);
}
