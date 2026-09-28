import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCompanyProfile } from "@/lib/company";
import { cancelCalendarEvent } from "@/lib/integrations/calendar";
import { emailMeetingInvitation } from "@/lib/meeting-mail";
import { loadMeetingForUser, type MeetingAttendee, meetingInclude, meetingUpdateSchema, toMeetingRow } from "@/lib/meetings";
import { firmMailbox, recordSentEmail } from "@/lib/outgoing-mail";
import { systemSender } from "@/lib/system-mail";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";

export const maxDuration = 30; // may send email through SMTP / provider APIs

/** Complete (logs the outcome to the permanent interaction log) or cancel a meeting. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireApiUser("meetings:manage");
    const m = await loadMeetingForUser(user, (await params).id);
    if (user.role !== "ADMIN" && m.organizerId !== user.id) throw new HttpError(403, "Only the organiser or an admin can update this meeting");
    if (m.status !== "SCHEDULED") throw new HttpError(400, "This meeting is already closed");
    const input = meetingUpdateSchema.parse(await req.json());
    const parent = { entityType: m.clientId ? "Client" : "Lead", entityId: (m.clientId ?? m.leadId)! };

    if (input.action === "cancel") {
      const attendees = ((m.attendees as MeetingAttendee[] | null) ?? []).filter((a) => a.email).map((a) => ({ email: a.email!, name: a.name }));
      let cancellation: Awaited<ReturnType<typeof emailMeetingInvitation>> | null = null;
      if (m.externalEventId && m.externalProvider === "SMTP") {
        // The invitation went out from the firm mailbox: email a cancellation the same way.
        const [mailbox, firm] = await Promise.all([firmMailbox(), getCompanyProfile()]);
        if (mailbox && attendees.length) {
          cancellation = await emailMeetingInvitation(user, toMeetingRow(m, user), attendees, { uid: m.externalEventId, firmName: firm.firmName, method: "CANCEL", reason: input.reason, from: mailbox.from }).catch(() => null);
        }
      } else if (m.externalEventId && m.externalProvider) {
        // The organiser's own calendar, or the firm's account that created the event on their behalf.
        let account = await prisma.connectedAccount.findUnique({ where: { userId_provider: { userId: m.organizerId, provider: m.externalProvider } } });
        if (!account) {
          const sender = await systemSender();
          if (sender.account?.provider === m.externalProvider) account = sender.account;
        }
        if (account) await cancelCalendarEvent(account, m.externalEventId, input.reason ?? undefined).catch(() => undefined);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.meeting.update({ where: { id: m.id }, data: { status: "CANCELLED", outcome: input.reason }, include: meetingInclude });
        if (cancellation) await recordSentEmail(tx, { user, sent: cancellation.sent, subject: cancellation.subject, body: cancellation.body, to: cancellation.to, leadId: m.leadId, clientId: m.clientId });
        await audit(tx, { ...parent, action: "meeting_cancelled", userId: user.id, metadata: { meetingId: m.id, title: m.title, reason: input.reason, cancellationEmailed: !!cancellation } });
        return u;
      });
      return NextResponse.json({ meeting: toMeetingRow(updated, user) });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.meeting.update({ where: { id: m.id }, data: { status: "COMPLETED", outcome: input.outcome }, include: meetingInclude });
      await tx.interaction.create({
        data: {
          type: "MEETING",
          occurredAt: m.startAt,
          summary: `${m.title}\n${input.outcome}`,
          clientId: m.clientId,
          leadId: m.leadId,
          loggedById: user.id,
        },
      });
      return u;
    });
    return NextResponse.json({ meeting: toMeetingRow(updated, user) });
  });
}
