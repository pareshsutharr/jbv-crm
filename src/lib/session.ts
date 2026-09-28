import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, type Permission } from "@/lib/rbac";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** null until the user completes the onboarding checklist (invited users). */
  onboardedAt?: Date | null;
};

/**
 * Loads the signed-in user fresh from the database so role changes and
 * deactivations take effect immediately, not only when the JWT expires.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, active: true, onboardedAt: true },
  });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, onboardedAt: user.onboardedAt };
}

/** For server components/pages. Redirects instead of throwing. */
export async function requirePageUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/forbidden");
  return user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For API route handlers. Throws HttpError, turned into JSON by `handle()`. */
export async function requireApiUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  if (permission && !can(user.role, permission)) throw new HttpError(403, "You do not have permission to do that");
  return user;
}

/** Wraps a route handler body with consistent error → JSON handling. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (err && typeof err === "object" && "issues" in err) {
      // zod validation error
      const issues = (err as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      const message = issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      const target = (err as { meta?: { target?: string[] } }).meta?.target?.join(", ") ?? "field";
      return NextResponse.json({ error: `A record with this ${target} already exists` }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
