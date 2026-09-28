/**
 * Every user sends email from the firm mailbox (Settings → System email):
 * the From shows "<user> via <firm>", replies go to the user's own address,
 * and the message is recorded on the lead / client timeline as sent by them.
 */
import type { IntegrationProvider, Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { getCompanyProfile } from "@/lib/company";
import { localMessageId } from "@/lib/email-sync";
import { type OutgoingMail, sendMail } from "@/lib/integrations/mail";
import { IntegrationError } from "@/lib/integrations/oauth";
import { prisma } from "@/lib/prisma";
import { smtpSettings, systemSender } from "@/lib/system-mail";

export const FIRM_MAILBOX_MISSING = "The firm's email isn't set up yet — an administrator can enter it under Settings → System email.";

export type FirmMailbox = { from: string; via: IntegrationProvider | "SMTP"; firmName: string };

/** The firm mailbox everyone sends from, or null when nothing is configured. */
export async function firmMailbox(): Promise<FirmMailbox | null> {
  const [sender, firm] = await Promise.all([systemSender(), getCompanyProfile()]);
  if (!sender.method || !sender.fromEmail) return null;
  return { from: sender.fromEmail, via: sender.method, firmName: firm.firmName };
}

export type SentMail = { from: string; provider: IntegrationProvider; accountId: string | null; externalId: string | null; threadId: string | null };

/** Sends `e` from the firm mailbox on behalf of `user`. Throws IntegrationError when the mailbox isn't set up or the send fails. */
export async function sendAsUser(user: { name: string; email: string }, e: OutgoingMail): Promise<SentMail> {
  const [sender, firm] = await Promise.all([systemSender(), getCompanyProfile()]);
  const fromName = `${user.name} via ${firm.firmName}`;
  if (sender.account) {
    const r = await sendMail(sender.account, { ...e, fromName, replyTo: user.email });
    return { from: sender.account.email, provider: sender.account.provider, accountId: sender.account.id, externalId: r.externalId, threadId: r.threadId };
  }
  const smtp = await smtpSettings();
  if (!smtp) throw new IntegrationError(FIRM_MAILBOX_MISSING);
  if (smtp.passwordUnreadable) throw new IntegrationError("The firm mailbox's saved password can't be read on this deployment — an administrator needs to re-enter it under Settings → Firm email.");
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const info = await transport.sendMail({
      from: { name: fromName, address: smtp.from },
      replyTo: user.email,
      to: e.to.join(", "),
      cc: e.cc.length ? e.cc.join(", ") : undefined,
      subject: e.subject,
      text: e.body,
      ...(e.ical ? { icalEvent: { method: e.ical.method, content: e.ical.content } } : {}),
    });
    return { from: smtp.from, provider: "SMTP", accountId: null, externalId: (info.messageId as string | undefined) ?? null, threadId: null };
  } catch (err) {
    throw new IntegrationError(`Email (${smtp.host}): ${(err as Error).message}`);
  }
}

/** Puts a sent message on the record's email timeline. */
export async function recordSentEmail(
  db: Prisma.TransactionClient | typeof prisma,
  args: { user: { id: string; name: string }; sent: SentMail; subject: string; body: string; to: string[]; cc?: string[]; leadId: string | null; clientId: string | null },
) {
  // Providers return a unique id; fall back to a local one if it's somehow already stored.
  let externalId = args.sent.externalId ?? localMessageId();
  if (args.sent.externalId && (await db.emailMessage.findUnique({ where: { provider_userId_externalId: { provider: args.sent.provider, userId: args.user.id, externalId } }, select: { id: true } }))) {
    externalId = localMessageId();
  }
  return db.emailMessage.create({
    data: {
      accountId: args.sent.accountId,
      provider: args.sent.provider,
      externalId,
      threadId: args.sent.threadId,
      subject: args.subject,
      snippet: args.body.slice(0, 200),
      bodyText: args.body,
      fromEmail: args.sent.from,
      fromName: args.user.name,
      toEmails: args.to,
      ccEmails: args.cc ?? [],
      sentAt: new Date(),
      direction: "OUTBOUND",
      userId: args.user.id,
      clientId: args.clientId,
      leadId: args.leadId,
    },
  });
}
