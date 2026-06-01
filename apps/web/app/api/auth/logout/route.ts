import { destroySession } from "../../../../lib/auth";
import { ok } from "../../../../lib/api";

export const runtime = "nodejs";

export async function POST() {
  await destroySession();
  return ok({ ok: true });
}
