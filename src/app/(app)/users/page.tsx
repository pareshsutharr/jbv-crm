import { PageBody, PageHeader } from "@/components/layout";
import { getCompanyProfile } from "@/lib/company";
import { invitationInclude, toInvitationRow } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/session";
import { userSelect } from "@/lib/users";
import { InvitationsCard } from "./invitations-card";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const me = await requirePageUser("users:manage");
  const [users, leadBooks, clientBooks, invitations, firm] = await Promise.all([
    prisma.user.findMany({ select: userSelect, orderBy: [{ active: "asc" }, { name: "asc" }] }),
    prisma.lead.groupBy({ by: ["assignedRmId"], where: { status: { not: "CONVERTED" }, assignedRmId: { not: null } }, _count: { _all: true } }),
    prisma.client.groupBy({ by: ["assignedRmId"], where: { assignedRmId: { not: null } }, _count: { _all: true } }),
    prisma.invitation.findMany({
      where: { OR: [{ acceptedAt: null }, { acceptedAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }] },
      include: invitationInclude,
      orderBy: { createdAt: "desc" },
    }),
    getCompanyProfile(),
  ]);
  const book = (id: string) => ({
    leads: leadBooks.find((b) => b.assignedRmId === id)?._count._all ?? 0,
    clients: clientBooks.find((b) => b.assignedRmId === id)?._count._all ?? 0,
  });
  const pending = users.filter((u) => !u.active).length;

  return (
    <>
      <PageHeader
        title="Users"
        description={`${users.length} users${pending ? ` · ${pending} awaiting activation` : ""}`}
      />
      <PageBody className="space-y-5">
        <InvitationsCard invitations={invitations.map(toInvitationRow)} firmName={firm.firmName} />
        <UsersTable
          users={users.map((u) => ({
            ...u,
            lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
            createdAt: u.createdAt.toISOString(),
            onboardedAt: u.onboardedAt?.toISOString() ?? null,
            book: u.role === "RM" ? book(u.id) : null,
          }))}
          currentUserId={me.id}
        />
      </PageBody>
    </>
  );
}
