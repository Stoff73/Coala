import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { currentUser } from "./auth";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Guard for authenticated routes. Returns the user, or a 401 Response to return
 * directly: `const u = await requireUser(); if (u instanceof Response) return u;`
 */
export async function requireUser(): Promise<User | Response> {
  const user = await currentUser();
  if (!user) return fail("Not authenticated.", 401);
  return user;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
