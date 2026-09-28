import type { Role } from "@prisma/client";

/**
 * Central permission matrix. Every page, API route and UI control checks
 * permissions through `can()` so the rules live in one place.
 *
 * "own" scoping (an RM only seeing their assigned records) is applied
 * separately by the `*Scope()` helpers below.
 */
export const PERMISSIONS = {
  "users:manage": ["ADMIN"],
  "settings:manage": ["ADMIN"],

  "leads:view": ["ADMIN", "COMPLIANCE", "RM", "VIEWER"],
  "leads:create": ["ADMIN", "RM"],
  "leads:edit": ["ADMIN", "RM"],
  "leads:delete": ["ADMIN"],
  "leads:assign": ["ADMIN"],
  "leads:convert": ["ADMIN", "RM"],

  "clients:view": ["ADMIN", "COMPLIANCE", "RM", "VIEWER"],
  "clients:edit": ["ADMIN", "RM"],
  "clients:assign": ["ADMIN"],

  "kyc:upload": ["ADMIN", "RM"],
  "docs:upload": ["ADMIN", "RM"], // general client documents (contract notes, RDD, forms…)
  "kyc:submit": ["ADMIN", "RM"], // PENDING/REJECTED -> SUBMITTED
  "kyc:review": ["ADMIN", "COMPLIANCE"], // -> UNDER_REVIEW / VERIFIED / REJECTED

  "ipos:view": ["ADMIN", "COMPLIANCE", "RM", "VIEWER"],
  "ipos:manage": ["ADMIN"],

  "mandates:view": ["ADMIN", "COMPLIANCE", "RM", "VIEWER"],
  "mandates:manage": ["ADMIN", "RM"], // create, edit and move stages (own clients for RMs)

  "interactions:log": ["ADMIN", "COMPLIANCE", "RM"], // on leads/clients they can see
  "interactions:amend": ["ADMIN"], // edit or soft-delete, always with a reason
  "interactions:viewRemoved": ["ADMIN", "COMPLIANCE"], // see text of removed entries

  "performance:view": ["ADMIN", "COMPLIANCE", "RM"],
  "performance:viewAll": ["ADMIN", "COMPLIANCE"],
  "performance:viewOwn": ["RM"],
  "performance:leaderboard": ["ADMIN"],

  "reports:view": ["ADMIN", "COMPLIANCE", "RM", "VIEWER"], // data is RM-scoped

  "tasks:manage": ["ADMIN", "COMPLIANCE", "RM"], // own tasks, on leads/clients they can see
  "tasks:assignOthers": ["ADMIN"],

  "meetings:manage": ["ADMIN", "COMPLIANCE", "RM"], // schedule / complete / cancel on records they can see
  "emails:send": ["ADMIN", "COMPLIANCE", "RM"],

  "dashboard:org": ["ADMIN", "COMPLIANCE", "VIEWER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** RMs only see records assigned to them; everyone else sees everything. */
export function isScopedToOwn(role: Role) {
  return role === "RM";
}

export function ownedScope(user: { id: string; role: Role }) {
  return isScopedToOwn(user.role) ? { assignedRmId: user.id } : {};
}

/** Can this user act on a specific record (after the role check passes)? */
export function ownsRecord(user: { id: string; role: Role }, record: { assignedRmId: string | null }) {
  return !isScopedToOwn(user.role) || record.assignedRmId === user.id;
}

/** Path-prefix rules used by middleware for coarse route protection. */
export const ROUTE_RULES: { prefix: string; permission: Permission }[] = [
  { prefix: "/users", permission: "users:manage" },
  { prefix: "/api/users", permission: "users:manage" },
  { prefix: "/api/invitations", permission: "users:manage" },
  { prefix: "/settings", permission: "settings:manage" },
  { prefix: "/api/settings/system-email", permission: "settings:manage" },
  { prefix: "/api/admin", permission: "users:manage" },
];
