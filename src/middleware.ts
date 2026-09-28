import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { can, ROUTE_RULES } from "@/lib/rbac";

// Coarse, token-based route protection. Fine-grained checks (and RM
// record ownership) are enforced again in every page and API handler.
export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;
    const path = req.nextUrl.pathname;
    const rule = ROUTE_RULES.find((r) => path === r.prefix || path.startsWith(r.prefix + "/"));
    if (rule && !can(role, rule.permission)) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/forbidden", req.url));
    }
    return NextResponse.next();
  },
  { pages: { signIn: "/login" } },
);

export const config = {
  // Everything except auth pages, NextAuth's own routes, signup / invite-acceptance APIs and static assets.
  // (`invite/` and `api/invite/` are public; `/api/invitations` — the admin API — is not.)
  matcher: ["/((?!login|signup|invite/|api/auth|api/signup|api/invite/|api/cron|api/public|api/settings/logo|_next/static|_next/image|favicon.ico).*)"],
};
