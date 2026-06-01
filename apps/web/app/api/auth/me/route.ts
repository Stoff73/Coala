import { currentUser, publicUser } from "../../../../lib/auth";
import { ok } from "../../../../lib/api";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  return ok({ user: user ? publicUser(user) : null });
}
