import type { ConnectedAccount } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { listMessagesSince, type NormalizedMessage } from "@/lib/integrations/mail";
import { prisma } from "@/lib/prisma";

/** Public mailbox domains never used for company-domain matching. */
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "proton.me", "protonmail.com", "zoho.com", "aol.com"]);

export type EmailTarget = { clientId?: string; leadId?: string };

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
const websiteDomain = (w: string | null) => (w ? w.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null);

/** Index of known email addresses and company domains → the CRM record they belong to. */
export async function buildEmailIndex() {
  const [contacts, leads, clients] = await Promise.all([
    prisma.contact.findMany({ where: { email: { not: null } }, select: { email: true, clientId: true, leadId: true } }),
    prisma.lead.findMany({ where: { email: { not: null }, client: null }, select: { id: true, email: true } }),
    prisma.client.findMany({ select: { id: true, email: true, website: true, leadId: true } }),
  ]);
  // Converted leads' addresses resolve to their client.
  const clientByLead = new Map(clients.filter((c) => c.leadId).map((c) => [c.leadId!, c.id]));
  const byEmail = new Map<string, EmailTarget>();
  const put = (email: string | null, t: EmailTarget) => {
    if (!email) return;
    const key = email.toLowerCase();
    const cur = byEmail.get(key);
    if (!cur || (!cur.clientId && t.clientId)) byEmail.set(key, t); // prefer clients
  };
  for (const l of leads) put(l.email, { leadId: l.id });
  for (const c of contacts) put(c.email, c.clientId ? { clientId: c.clientId } : clientByLead.get(c.leadId!) ? { clientId: clientByLead.get(c.leadId!)! } : { leadId: c.leadId! });
  for (const c of clients) put(c.email, { clientId: c.id });
  const byDomain = new Map<string, EmailTarget>();
  for (const c of clients) {
    const d = websiteDomain(c.website);
    if (d && !FREE_MAIL.has(d)) byDomain.set(d, { clientId: c.id });
  }
  return { byEmail, byDomain };
}

export function matchMessage(index: Awaited<ReturnType<typeof buildEmailIndex>>, participants: string[], ownerEmail: string): EmailTarget | null {
  const others = participants.map((e) => e.toLowerCase()).filter((e) => e !== ownerEmail.toLowerCase());
  const exact = others.map((e) => index.byEmail.get(e)).filter(Boolean) as EmailTarget[];
  if (exact.length) return exact.find((t) => t.clientId) ?? exact[0];
  for (const e of others) {
    const d = domainOf(e);
    if (!FREE_MAIL.has(d) && index.byDomain.has(d)) return index.byDomain.get(d)!;
  }
  return null;
}

/**
 * Pulls new messages from one connected mailbox and stores those exchanged
 * with a known lead/client. Unrelated personal mail is never stored.
 */
export async function syncAccount(account: ConnectedAccount, now = new Date()) {
  // SMTP mailboxes send only; there is nothing to pull.
  if (account.provider === "SMTP") return { fetched: 0, stored: 0, skipped: true };
  const since = account.lastSyncAt ? new Date(account.lastSyncAt.getTime() - 5 * 60_000) : new Date(now.getTime() - 30 * 86_400_000);
  try {
    const [messages, index] = await Promise.all([listMessagesSince(account, since), buildEmailIndex()]);
    let stored = 0;
    for (const m of messages) {
      stored += (await storeMessage(account, m, index)) ? 1 : 0;
    }
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastSyncAt: now, syncError: null } });
    return { fetched: messages.length, stored };
  } catch (err) {
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { syncError: (err as Error).message.slice(0, 500) } });
    throw err;
  }
}

async function storeMessage(account: ConnectedAccount, m: NormalizedMessage, index: Awaited<ReturnType<typeof buildEmailIndex>>) {
  const participants = [m.from.email, ...m.to.map((a) => a.email), ...m.cc.map((a) => a.email)];
  const target = matchMessage(index, participants, account.email);
  if (!target) return false;
  const direction = m.from.email === account.email.toLowerCase() ? "OUTBOUND" : "INBOUND";
  const data = {
    threadId: m.threadId,
    subject: m.subject.slice(0, 500),
    snippet: m.snippet?.slice(0, 500) ?? null,
    bodyText: m.bodyText,
    fromEmail: m.from.email,
    fromName: m.from.name,
    toEmails: m.to.map((a) => a.email),
    ccEmails: m.cc.map((a) => a.email),
    sentAt: m.sentAt,
    direction: direction as "OUTBOUND" | "INBOUND",
    clientId: target.clientId ?? null,
    leadId: target.leadId ?? null,
  };
  // A message we sent from the CRM via Outlook was stored with a local id; adopt the real one.
  if (direction === "OUTBOUND") {
    const local = await prisma.emailMessage.findFirst({
      where: {
        userId: account.userId,
        provider: account.provider,
        externalId: { startsWith: "local:" },
        subject: data.subject,
        sentAt: { gte: new Date(m.sentAt.getTime() - 10 * 60_000), lte: new Date(m.sentAt.getTime() + 10 * 60_000) },
      },
    });
    if (local) {
      await prisma.emailMessage.update({ where: { id: local.id }, data: { ...data, externalId: m.externalId } });
      return true;
    }
  }
  await prisma.emailMessage.upsert({
    where: { provider_userId_externalId: { provider: account.provider, userId: account.userId, externalId: m.externalId } },
    create: { ...data, accountId: account.id, provider: account.provider, userId: account.userId, externalId: m.externalId },
    update: data,
  });
  return true;
}

export async function syncAllMailboxes() {
  const accounts = await prisma.connectedAccount.findMany({ where: { user: { active: true } } });
  const results = [];
  for (const a of accounts) {
    try {
      results.push({ account: a.email, ...(await syncAccount(a)) });
    } catch (err) {
      results.push({ account: a.email, error: (err as Error).message });
    }
  }
  return results;
}

export const localMessageId = () => `local:${randomUUID()}`;
