import { prisma } from "@/lib/prisma";

export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  designation: true,
  phone: true,
  whatsapp: true,
  meetingLink: true,
  onboardedAt: true,
  lastLoginAt: true,
  createdAt: true,
  connectedAccounts: { select: { provider: true, email: true } },
} as const;

/** Active RMs, for assignment dropdowns and filters. */
export function listRms() {
  return prisma.user.findMany({
    where: { role: "RM", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Active users who can lead a mandate (RMs and Admins), as select options. */
export async function advisorOptions() {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: ["RM", "ADMIN"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ value: u.id, label: u.name }));
}
