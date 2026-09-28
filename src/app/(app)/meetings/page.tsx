import Link from "next/link";
import { Card, PageBody, PageHeader } from "@/components/layout";
import { MeetingList } from "@/components/meetings-card";
import { getCompanyProfile } from "@/lib/company";
import { meetingInclude, toMeetingRow } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/session";
import { firmWhatsappLinked } from "@/lib/whatsapp-client";

export default async function MeetingsPage() {
  const user = await requirePageUser("meetings:manage");
  const now = new Date();
  const [upcoming, recent, accounts, firm, linked] = await Promise.all([
    prisma.meeting.findMany({ where: { organizerId: user.id, status: "SCHEDULED", endAt: { gte: now } }, include: meetingInclude, orderBy: { startAt: "asc" } }),
    prisma.meeting.findMany({
      where: { organizerId: user.id, OR: [{ status: { not: "SCHEDULED" } }, { endAt: { lt: now } }], startAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } },
      include: meetingInclude,
      orderBy: { startAt: "desc" },
    }),
    prisma.connectedAccount.count({ where: { userId: user.id } }),
    getCompanyProfile(),
    firmWhatsappLinked(),
  ]);
  const needsOutcome = recent.filter((m) => m.status === "SCHEDULED");
  return (
    <>
      <PageHeader title="My meetings" description={`${upcoming.length} upcoming${needsOutcome.length ? ` · ${needsOutcome.length} awaiting outcome` : ""}`} />
      <PageBody className="space-y-5">
        {accounts === 0 && (
          <p className="rounded-md bg-gold-50 px-3 py-2 text-sm text-gray-800">
            Add your email under{" "}
            <Link href="/account" className="font-medium text-brand-600 underline">
              My account
            </Link>{" "}
            to send calendar invitations automatically (Google / Microsoft also create Meet / Teams links). Schedule meetings from a lead or client page.
          </p>
        )}
        <Card title="Upcoming">
          <MeetingList meetings={upcoming.map((m) => toMeetingRow(m, user))} showRelated firmName={firm.firmName} whatsappLinked={linked} />
        </Card>
        {needsOutcome.length > 0 && (
          <Card title="Record the outcome">
            <MeetingList meetings={needsOutcome.map((m) => toMeetingRow(m, user))} showRelated firmName={firm.firmName} whatsappLinked={linked} />
          </Card>
        )}
        <Card title="Last 60 days">
          <MeetingList meetings={recent.filter((m) => m.status !== "SCHEDULED").map((m) => toMeetingRow(m, user))} showRelated firmName={firm.firmName} whatsappLinked={linked} />
        </Card>
      </PageBody>
    </>
  );
}
