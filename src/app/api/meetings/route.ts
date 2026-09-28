import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { getCompanyProfile } from "@/lib/company";
import { assertCanAccessParent } from "@/lib/interactions";
import { createCalendarEvent } from "@/lib/integrations/calendar";
import { IntegrationError } from "@/lib/integrations/oauth";
import { emailMeetingInvitation } from "@/lib/meeting-mail";
import { firmMailbox, recordSentEmail, type SentMail } from "@/lib/outgoing-mail";
import { MEETING_PROVIDER_LABELS, meetingCreateSchema, meetingInclude, REQUIRED_ACCOUNT, toMeetingRow } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";

export const maxDuration = 30; // may send email through SMTP / provider APIs

/** ?leadId= / ?clientId= for a record's meetings; otherwise the signed-in user's upcoming meetings. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser("leads:view");
    const sp = new URL(req.url).searchParams;
    const leadId = sp.get("leadId");
    const clientId = sp.get("clientId");
    let where: Prisma.MeetingWhereInput;
    if (leadId || clientId) {
      await assertCanAccessParent(user, { leadId, clientId });
      where = { leadId: leadId ?? undefined, clientId: clientId ?? undefined };
    } else {
      where = { organizerId: user.id, status: "SCHEDULED", endAt: { gte: new Date() } };
    }
    const meetings = await prisma.meeting.findMany({ where, include: meetingInclude, orderBy: { startAt: "asc" } });
    return NextResponse.json({ meetings: meetings.map((m) => toMeetingRow(m, user)) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser("meetings:manage");
    const input = meetingCreateSchema.parse(await req.json());
    await assertCanAccessParent(user, input);
    if (input.mandateId && !(await prisma.mandate.findFirst({ where: { id: input.mandateId, clientId: input.clientId ?? "" } }))) {
      throw new HttpError(400, "That mandate belongs to another client");
    }
    const endAt = new Date(input.startAt.getTime() + input.durationMin * 60_000);
    // Calendar invites need an address; WhatsApp-only attendees are reached via the share actions.
    const emailAttendees = input.attendees.filter((a) => a.email).map((a) => ({ email: a.email!, name: a.name }));

    // A connected Google / Microsoft calendar creates the event (and Meet / Teams link) and sends its own invites.
    const calendars = await prisma.connectedAccount.findMany({ where: { userId: user.id, provider: { in: ["GOOGLE", "MICROSOFT"] } }, orderBy: { createdAt: "asc" } });
    const needed = REQUIRED_ACCOUNT[input.provider];
    let account = needed ? calendars.find((a) => a.provider === needed) : calendars[0];
    if (needed && !account && !input.joinUrl) {
      throw new HttpError(400, `Connect your ${needed === "GOOGLE" ? "Google" : "Microsoft"} account under My account to create ${MEETING_PROVIDER_LABELS[input.provider]} links, or paste a link.`);
    }
    if (!input.addToCalendar) account = undefined;

    let externalEventId: string | null = null;
    let externalProvider: "GOOGLE" | "MICROSOFT" | "SMTP" | null = null;
    let joinUrl = input.joinUrl;
    let inviteEmail: { sent: SentMail; subject: string; body: string; to: string[] } | undefined;
    if (account) {
      try {
        const ev = await createCalendarEvent(account, {
          title: input.title,
          agenda: [input.agenda, joinUrl && !needed ? `Join: ${joinUrl}` : null].filter(Boolean).join("\n\n") || null,
          startAt: input.startAt,
          endAt,
          attendees: emailAttendees,
          location: input.location,
          online: !!needed && !input.joinUrl,
        });
        externalEventId = ev.externalEventId;
        externalProvider = account.provider as "GOOGLE" | "MICROSOFT";
        joinUrl = joinUrl ?? ev.joinUrl;
      } catch (err) {
        if (err instanceof IntegrationError) throw new HttpError(502, `Calendar: ${err.message}`);
        throw err;
      }
    } else if (input.addToCalendar && emailAttendees.length) {
      // No calendar connected: email the invitation (with a calendar file) from the firm mailbox as this user.
      const mailbox = await firmMailbox();
      if (mailbox) {
        const [firm, me] = await Promise.all([getCompanyProfile(), prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { designation: true, whatsapp: true } })]);
        const uid = `${randomUUID()}@crm`;
        try {
          inviteEmail = await emailMeetingInvitation(
            user,
            { title: input.title, agenda: input.agenda, startAt: input.startAt, endAt, provider: input.provider, joinUrl, location: input.location, organizerDetails: { name: user.name, designation: me.designation, whatsapp: me.whatsapp, email: user.email } },
            emailAttendees,
            { uid, firmName: firm.firmName, method: "REQUEST", from: mailbox.from },
          );
          externalEventId = uid;
          externalProvider = "SMTP"; // "invitation emailed"
        } catch (err) {
          if (err instanceof IntegrationError) throw new HttpError(502, err.message);
          throw err;
        }
      }
    }

    const meeting = await prisma.$transaction(async (tx) => {
      const m = await tx.meeting.create({
        data: {
          title: input.title,
          agenda: input.agenda,
          startAt: input.startAt,
          endAt,
          provider: input.provider,
          joinUrl,
          location: input.location,
          attendees: input.attendees,
          externalEventId,
          externalProvider,
          leadId: input.leadId,
          clientId: input.clientId,
          mandateId: input.mandateId,
          organizerId: user.id,
        },
        include: meetingInclude,
      });
      await audit(tx, {
        entityType: input.clientId ? "Client" : "Lead",
        entityId: (input.clientId ?? input.leadId)!,
        action: "meeting_scheduled",
        userId: user.id,
        metadata: { meetingId: m.id, title: m.title, startAt: m.startAt.toISOString(), provider: m.provider, invitesEmailed: inviteEmail?.to },
      });
      // An invitation emailed from the firm mailbox belongs on the record's email timeline.
      if (inviteEmail) {
        await recordSentEmail(tx, { user, sent: inviteEmail.sent, subject: inviteEmail.subject, body: inviteEmail.body, to: inviteEmail.to, leadId: input.leadId, clientId: input.clientId });
      }
      return m;
    });
    return NextResponse.json({ meeting: toMeetingRow(meeting, user) }, { status: 201 });
  });
}
