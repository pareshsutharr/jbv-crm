import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getCompanyProfile } from "@/lib/company";
import { IntegrationError } from "@/lib/integrations/oauth";
import { emailMeetingInvitation } from "@/lib/meeting-mail";
import { meetingShareText, meetingWhen } from "@/lib/meeting-share";
import { loadMeetingForUser, toMeetingRow } from "@/lib/meetings";
import { firmMailbox, recordSentEmail } from "@/lib/outgoing-mail";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";
import { optionalText } from "@/lib/validation";
import { firmWhatsappLinked, sendFirmWhatsAppText, WhatsAppError } from "@/lib/whatsapp-client";

const schema = z.discriminatedUnion("channel", [
  // Email the details from the firm mailbox as the user (defaults to every attendee with an email).
  z.object({ channel: z.literal("email"), to: z.array(z.string().trim().toLowerCase().email()).max(50).optional() }),
  // WhatsApp: from the firm's linked WhatsApp when available; otherwise the browser opens wa.me and this only records it.
  z.object({ channel: z.literal("whatsapp"), phone: optionalText(40), name: optionalText(120) }),
]);

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireApiUser("meetings:manage");
    const m = await loadMeetingForUser(user, (await params).id);
    if (user.role !== "ADMIN" && m.organizerId !== user.id) throw new HttpError(403, "Only the organiser or an admin can share this meeting");
    if (m.status !== "SCHEDULED") throw new HttpError(400, "This meeting is already closed");
    const input = schema.parse(await req.json());
    const parent = { entityType: m.clientId ? "Client" : "Lead", entityId: (m.clientId ?? m.leadId)! };
    const row = toMeetingRow(m, user);
    const firm = await getCompanyProfile();

    if (input.channel === "whatsapp") {
      const text = meetingShareText(row, firm.firmName);
      if (input.phone && (await firmWhatsappLinked())) {
        let sent;
        try {
          sent = await sendFirmWhatsAppText(input.phone, text);
        } catch (err) {
          if (err instanceof WhatsAppError) throw new HttpError(502, err.message);
          throw err;
        }
        await prisma.$transaction(async (tx) => {
          await tx.interaction.create({
            data: {
              type: "WHATSAPP",
              occurredAt: new Date(),
              summary: `Meeting details ${sent.queued ? "queued for" : "sent on"} WhatsApp to ${input.name ? `${input.name} (${sent.to})` : sent.to} by ${user.name}: "${m.title}", ${meetingWhen(row)}`,
              leadId: m.leadId,
              clientId: m.clientId,
              loggedById: user.id,
            },
          });
          await audit(tx, { ...parent, action: "meeting_shared_whatsapp", userId: user.id, metadata: { meetingId: m.id, title: m.title, phone: sent.to, name: input.name, direct: true } });
        });
        return NextResponse.json({ direct: true, queued: sent.queued, to: sent.to });
      }
      await audit(prisma, { ...parent, action: "meeting_shared_whatsapp", userId: user.id, metadata: { meetingId: m.id, title: m.title, phone: input.phone, name: input.name, direct: false } });
      return NextResponse.json({ direct: false });
    }

    const mailbox = await firmMailbox();
    if (!mailbox) throw new HttpError(400, "The firm's email isn't set up yet — an administrator can enter it under Settings → System email.");
    const recipients = input.to?.length ? input.to : row.attendees.filter((a) => a.email).map((a) => a.email!);
    if (!recipients.length) throw new HttpError(400, "None of the attendees has an email address");
    const attendees = recipients.map((email) => ({ email, name: row.attendees.find((a) => a.email === email)?.name }));
    const uid = m.externalProvider === "SMTP" && m.externalEventId ? m.externalEventId : `${m.id}@crm`;
    let result;
    try {
      result = await emailMeetingInvitation(user, row, attendees, { uid, firmName: firm.firmName, method: "REQUEST", from: mailbox.from });
    } catch (err) {
      if (err instanceof IntegrationError) throw new HttpError(502, err.message);
      throw err;
    }
    await prisma.$transaction(async (tx) => {
      await recordSentEmail(tx, { user, sent: result.sent, subject: result.subject, body: result.body, to: result.to, leadId: m.leadId, clientId: m.clientId });
      await audit(tx, { ...parent, action: "meeting_invite_emailed", userId: user.id, metadata: { meetingId: m.id, title: m.title, to: recipients, from: result.sent.from } });
    });
    return NextResponse.json({ sentTo: recipients, from: result.sent.from });
  });
}
