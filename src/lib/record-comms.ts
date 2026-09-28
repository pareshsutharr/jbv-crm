import { prisma } from "@/lib/prisma";
import { meetingInclude, toMeetingRow } from "@/lib/meetings";
import { firmMailbox } from "@/lib/outgoing-mail";
import { systemSender } from "@/lib/system-mail";
import type { CurrentUser } from "@/lib/session";
import { firmWhatsappStatus } from "@/lib/whatsapp-client";

/** Meetings, captured emails and the user's connected accounts for a lead / client page. */
export async function loadRecordComms(user: CurrentUser, target: { leadId?: string; clientId?: string }) {
  const [meetings, emails, accounts, me, wa, mailbox, sender] = await Promise.all([
    prisma.meeting.findMany({ where: target, include: meetingInclude, orderBy: { startAt: "asc" } }),
    prisma.emailMessage.findMany({ where: target, include: { user: { select: { name: true } } }, orderBy: { sentAt: "desc" }, take: 300 }),
    prisma.connectedAccount.findMany({ where: { userId: user.id }, select: { provider: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { whatsapp: true, meetingLink: true } }),
    firmWhatsappStatus(),
    firmMailbox(),
    systemSender(),
  ]);
  const firmCalendar = sender.account && sender.account.provider !== "SMTP" ? sender.account.provider : null;
  return {
    /** The signed-in user's own details, offered when scheduling / sharing. */
    me: { whatsapp: me?.whatsapp ?? null, meetingLink: me?.meetingLink ?? null, whatsappLinked: wa.status === "connected" || wa.status === "connecting" },
    /** The firm's shared channels. */
    firm: { mailbox: mailbox ? { from: mailbox.from } : null, whatsapp: { linked: wa.status === "connected" || wa.status === "connecting", phone: wa.phone, available: wa.available } },
    meetings: meetings.map((m) => toMeetingRow(m, user)),
    emails: emails.map((e) => ({
      id: e.id,
      threadId: e.threadId,
      subject: e.subject,
      snippet: e.snippet,
      bodyText: e.bodyText,
      fromEmail: e.fromEmail,
      fromName: e.fromName,
      toEmails: e.toEmails,
      ccEmails: e.ccEmails,
      sentAt: e.sentAt.toISOString(),
      direction: e.direction,
      mailbox: e.user.name,
    })),
    connected: { google: accounts.some((a) => a.provider === "GOOGLE"), microsoft: accounts.some((a) => a.provider === "MICROSOFT"), firmMailbox: !!mailbox, firmCalendar },
  };
}
