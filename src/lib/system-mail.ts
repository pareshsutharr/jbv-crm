import type { ConnectedAccount, IntegrationProvider } from "@prisma/client";
import nodemailer from "nodemailer";
import { tryDecrypt } from "@/lib/crypto";
import { PROVIDER_LABELS } from "@/lib/integrations/config";
import { sendMail } from "@/lib/integrations/mail";
import { IntegrationError } from "@/lib/integrations/oauth";
import { prisma } from "@/lib/prisma";

/**
 * "System" email — invitations, test mails — as opposed to a user's own
 * correspondence. It is sent, in order of preference, through:
 *   1. the connected Gmail / Outlook mailbox of the *system sender* user
 *      (Settings → System email; defaults to the first admin with a mailbox);
 *   2. SMTP, from Settings → System email (stored encrypted) or, failing that,
 *      the SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM environment;
 * and otherwise reports that it couldn't be sent, so the caller can fall back
 * to showing a link the admin shares by hand (copy / WhatsApp).
 */

export type SystemMailVia = IntegrationProvider | "SMTP";

export type SmtpSettings = {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
  secure: boolean;
  /** Where the values came from. */
  source: "settings" | "env";
  /** A password is stored but can't be decrypted on this deployment (encryption key changed): it must be re-entered. */
  passwordUnreadable?: boolean;
};

const smtpSelect = { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true } as const;
type SmtpRow = { smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; smtpPass: string | null; smtpFrom: string | null; smtpSecure: boolean };

/** SMTP from the SMTP_* environment variables, if set. */
export function smtpFromEnv(): SmtpSettings | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || null;
  const from = process.env.SMTP_FROM || user;
  if (!from) return null;
  return { host, port, user, pass: process.env.SMTP_PASS || null, from, secure: process.env.SMTP_SECURE === "true" || port === 465, source: "env" };
}

/** SMTP as configured under Settings (preferred), else from the environment. */
export async function smtpSettings(row?: SmtpRow | null): Promise<SmtpSettings | null> {
  const p = row === undefined ? await prisma.companyProfile.findUnique({ where: { id: 1 }, select: smtpSelect }) : row;
  if (p?.smtpHost) {
    const from = p.smtpFrom || p.smtpUser;
    if (from) {
      const pass = tryDecrypt(p.smtpPass);
      return { host: p.smtpHost, port: p.smtpPort ?? 587, user: p.smtpUser, pass, from, secure: p.smtpSecure, source: "settings", passwordUnreadable: !!p.smtpPass && !pass };
    }
  }
  return smtpFromEnv();
}

export type SystemSender = {
  user: { id: string; name: string; email: string } | null;
  account: ConnectedAccount | null;
  /** SMTP without the password, for display. */
  smtp: { host: string; port: number; user: string | null; from: string; secure: boolean; source: "settings" | "env"; passwordUnreadable?: boolean } | null;
  /** How a system email would go out right now; null = not set up. */
  method: SystemMailVia | null;
  fromEmail: string | null;
  /** Human-readable summary for the Settings page. */
  summary: string;
};

export async function systemSender(): Promise<SystemSender> {
  const profile = await prisma.companyProfile.findUnique({ where: { id: 1 }, select: { systemSenderUserId: true, email: true, ...smtpSelect } });
  const include = { connectedAccounts: { orderBy: { createdAt: "asc" as const } } };
  let user = profile?.systemSenderUserId ? await prisma.user.findFirst({ where: { id: profile.systemSenderUserId, active: true }, include }) : null;
  if (!user) user = await prisma.user.findFirst({ where: { role: "ADMIN", active: true, connectedAccounts: { some: {} } }, orderBy: { createdAt: "asc" }, include });
  if (!user) user = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" }, include });
  const account = user?.connectedAccounts[0] ?? null;
  const smtpFull = await smtpSettings(profile ?? null);
  const smtp = smtpFull ? { host: smtpFull.host, port: smtpFull.port, user: smtpFull.user, from: smtpFull.from, secure: smtpFull.secure, source: smtpFull.source, passwordUnreadable: smtpFull.passwordUnreadable } : null;
  const method: SystemMailVia | null = account ? account.provider : smtp ? "SMTP" : null;
  const fromEmail = account?.email ?? smtp?.from ?? profile?.email ?? user?.email ?? null;
  const summary = account
    ? `Sends from ${account.email} through ${user!.name}'s connected ${PROVIDER_LABELS[account.provider]} account.`
    : smtp?.passwordUnreadable
      ? `SMTP (${smtp.host}) is configured but its saved password can't be read on this deployment — re-enter the password below and save.`
      : smtp
        ? `Sends from ${smtp.from} through SMTP (${smtp.host}${smtp.source === "env" ? ", from the server environment" : ""}).`
      : user
        ? `Not set up yet: ${user.name} (${user.email}) needs to connect Google or Microsoft under My account, or enter SMTP settings below. Until then, invitation links are shared by hand.`
        : "Not set up yet: no active administrator. Enter SMTP settings below or connect an admin's mailbox.";
  return {
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
    account,
    smtp,
    method,
    fromEmail,
    summary,
  };
}

export type SystemMailResult = { sent: true; via: SystemMailVia; from: string } | { sent: false; reason: string };

export async function sendSystemEmail(e: { to: string[]; subject: string; body: string }): Promise<SystemMailResult> {
  const sender = await systemSender();
  if (sender.account) {
    try {
      await sendMail(sender.account, { to: e.to, cc: [], subject: e.subject, body: e.body });
      return { sent: true, via: sender.account.provider, from: sender.account.email };
    } catch (err) {
      if (err instanceof IntegrationError) return { sent: false, reason: `${PROVIDER_LABELS[sender.account.provider]}: ${err.message}` };
      throw err;
    }
  }
  const smtp = await smtpSettings();
  if (smtp?.passwordUnreadable) return { sent: false, reason: `The saved SMTP password can't be read on this deployment — re-enter it under Settings → Firm email.` };
  if (smtp) {
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
      await transport.sendMail({ from: smtp.from, to: e.to.join(", "), subject: e.subject, text: e.body });
      return { sent: true, via: "SMTP", from: smtp.from };
    } catch (err) {
      return { sent: false, reason: `SMTP (${smtp.host}): ${(err as Error).message}` };
    }
  }
  return { sent: false, reason: sender.summary };
}
