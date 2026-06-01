import { prisma } from "../../../../lib/db";
import { createSession, publicUser, verifyPassword } from "../../../../lib/auth";
import { fail, ok } from "../../../../lib/api";
import { acceptPendingInvites } from "../../../../lib/workspaces";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") {
    return fail("Email and password are required.");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Use the same message for unknown email and bad password (avoid user enumeration).
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return fail("Invalid email or password.", 401);
  }

  await acceptPendingInvites(user);
  await createSession(user.id);
  return ok({ user: publicUser(user) });
}
