import { prisma } from "../../../../lib/db";
import { createSession, hashPassword, publicUser } from "../../../../lib/auth";
import { fail, isValidEmail, ok } from "../../../../lib/api";
import { acceptPendingInvites } from "../../../../lib/workspaces";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { email, password, name } = await request.json().catch(() => ({}));

  if (!isValidEmail(email)) return fail("A valid email is required.");
  if (typeof password !== "string" || password.length < 8) {
    return fail("Password must be at least 8 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail("An account with that email already exists.", 409);

  const passwordHash = await hashPassword(password);

  // Create the user and their personal workspace together.
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email, name: typeof name === "string" ? name : null, passwordHash },
    });
    const ws = await tx.workspace.create({ data: { name: "Personal", personal: true } });
    await tx.workspaceMember.create({
      data: { workspaceId: ws.id, userId: u.id, role: "owner" },
    });
    return u;
  });

  await acceptPendingInvites(user);
  await createSession(user.id);
  return ok({ user: publicUser(user) }, 201);
}
