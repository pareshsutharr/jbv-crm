import type { ConnectedAccount } from "@prisma/client";
import nodemailer from "nodemailer";
import { decrypt } from "@/lib/crypto";
import { GOOGLE, MICROSOFT } from "./config";
import { apiFetch, IntegrationError } from "./oauth";

export type Address = { email: string; name: string | null };
export type NormalizedMessage = {
  externalId: string;
  threadId: string | null;
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  sentAt: Date;
};

const MAX_BODY = 20_000;

/** Parses `"Name" <a@b.com>, c@d.com` into addresses. */
export function parseAddressList(value: string | undefined | null): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  const re = /(?:"?([^"<,]*?)"?\s*<([^>]+)>)|([^\s,<>]+@[^\s,<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const email = (m[2] ?? m[3]).trim().toLowerCase();
    const name = m[1]?.trim() || null;
    out.push({ email, name });
  }
  return out;
}

const htmlToText = (html: string) =>
  html
    .replace(/<(br|\/p|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ─── Gmail ────────────────────────────────────────────────────────────────

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = { id: string; threadId: string; snippet?: string; internalDate?: string; payload?: GmailPart & { headers?: { name: string; value: string }[] } };

function gmailBody(part: GmailPart | undefined): string | null {
  if (!part) return null;
  const decode = (d?: string) => (d ? Buffer.from(d, "base64url").toString("utf8") : null);
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const t = gmailBody(p);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) return htmlToText(decode(part.body.data)!);
  return null;
}

async function listGmail(account: ConnectedAccount, since: Date): Promise<NormalizedMessage[]> {
  const base = `${GOOGLE.gmailUrl()}/gmail/v1/users/me/messages`;
  const ids: { id: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const qs = new URLSearchParams({ q: `after:${Math.floor(since.getTime() / 1000)}`, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    const res = await apiFetch<{ messages?: { id: string }[]; nextPageToken?: string }>(account, `${base}?${qs}`);
    ids.push(...(res.messages ?? []));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  const out: NormalizedMessage[] = [];
  for (const { id } of ids) {
    const m = await apiFetch<GmailMessage>(account, `${base}/${id}?format=full`);
    const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value;
    const from = parseAddressList(h("From"))[0];
    if (!from) continue;
    out.push({
      externalId: m.id,
      threadId: m.threadId,
      subject: h("Subject") ?? "(no subject)",
      snippet: m.snippet ?? null,
      bodyText: gmailBody(m.payload)?.slice(0, MAX_BODY) ?? null,
      from,
      to: parseAddressList(h("To")),
      cc: parseAddressList(h("Cc")),
      sentAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(h("Date") ?? Date.now()),
    });
  }
  return out;
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

export function buildMime(from: string, e: { to: string[]; cc: string[]; subject: string; body: string; fromName?: string | null; replyTo?: string | null }) {
  const lines = [
    `From: ${e.fromName ? `${encodeHeader(`"${e.fromName.replace(/"/g, "'")}"`)} <${from}>` : from}`,
    `To: ${e.to.join(", ")}`,
    ...(e.cc.length ? [`Cc: ${e.cc.join(", ")}`] : []),
    ...(e.replyTo ? [`Reply-To: ${e.replyTo}`] : []),
    `Subject: ${encodeHeader(e.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(e.body).toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// ─── Microsoft Graph ──────────────────────────────────────────────────────

type GraphAddress = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  sentDateTime?: string;
  receivedDateTime?: string;
};
const graphAddr = (a?: GraphAddress): Address | null => (a?.emailAddress?.address ? { email: a.emailAddress.address.toLowerCase(), name: a.emailAddress.name ?? null } : null);

async function listGraph(account: ConnectedAccount, since: Date): Promise<NormalizedMessage[]> {
  const select = "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime";
  let url: string | undefined =
    `${MICROSOFT.graphUrl()}/me/messages?` +
    new URLSearchParams({ $filter: `receivedDateTime ge ${since.toISOString()}`, $select: select, $top: "50", $orderby: "receivedDateTime desc" });
  const out: NormalizedMessage[] = [];
  for (let page = 0; page < 4 && url; page++) {
    const res: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await apiFetch(account, url, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    for (const m of res.value ?? []) {
      const from = graphAddr(m.from);
      if (!from) continue;
      const text = m.body?.content ? (m.body.contentType === "html" ? htmlToText(m.body.content) : m.body.content) : null;
      out.push({
        externalId: m.id,
        threadId: m.conversationId ?? null,
        subject: m.subject || "(no subject)",
        snippet: m.bodyPreview ?? null,
        bodyText: text?.slice(0, MAX_BODY) ?? null,
        from,
        to: (m.toRecipients ?? []).map(graphAddr).filter((x): x is Address => !!x),
        cc: (m.ccRecipients ?? []).map(graphAddr).filter((x): x is Address => !!x),
        sentAt: new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now()),
      });
    }
    url = res["@odata.nextLink"];
  }
  return out;
}

// ─── SMTP (any mailbox with an app password; sending only) ────────────────

export { detectSmtpPreset as detectSmtp } from "@/lib/smtp-presets";

export type SmtpAccountConfig = { host: string; port: number; secure: boolean; user: string; pass: string };

export function smtpTransport(c: SmtpAccountConfig) {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Connects and authenticates without sending; throws IntegrationError with the server's reason. */
export async function verifySmtp(c: SmtpAccountConfig) {
  try {
    await smtpTransport(c).verify();
  } catch (err) {
    throw new IntegrationError(`Could not sign in to ${c.host}: ${(err as Error).message}`);
  }
}

function smtpConfigOf(account: ConnectedAccount): SmtpAccountConfig {
  if (!account.smtpHost) throw new IntegrationError("This mailbox has no SMTP host — remove it and add it again");
  return { host: account.smtpHost, port: account.smtpPort ?? 587, secure: account.smtpSecure, user: account.smtpUser || account.email, pass: decrypt(account.accessToken) };
}

// ─── Public API ───────────────────────────────────────────────────────────

export function listMessagesSince(account: ConnectedAccount, since: Date): Promise<NormalizedMessage[]> {
  if (account.provider === "SMTP") return Promise.resolve([]); // sending only
  if (account.provider === "GOOGLE" && account.scopes && !/gmail/.test(account.scopes)) return Promise.resolve([]); // calendar-only connection
  return account.provider === "GOOGLE" ? listGmail(account, since) : listGraph(account, since);
}

export type OutgoingMail = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** Display name for the From header. */
  fromName?: string | null;
  /** Where replies should go (e.g. the user's own address when sending from the firm mailbox). */
  replyTo?: string | null;
  /** Calendar invitation attached as text/calendar (SMTP only; Google / Microsoft send real invites via their calendar). */
  ical?: { method: "REQUEST" | "CANCEL"; content: string };
};

/** Sends a plain-text email from the connected mailbox. Returns the provider id when known. */
export async function sendMail(account: ConnectedAccount, e: OutgoingMail) {
  if (account.provider === "SMTP") {
    const cfg = smtpConfigOf(account);
    try {
      const info = await smtpTransport(cfg).sendMail({
        from: e.fromName ? { name: e.fromName, address: account.email } : account.email,
        replyTo: e.replyTo ?? undefined,
        to: e.to.join(", "),
        cc: e.cc.length ? e.cc.join(", ") : undefined,
        subject: e.subject,
        text: e.body,
        ...(e.ical ? { icalEvent: { method: e.ical.method, content: e.ical.content } } : {}),
      });
      return { externalId: (info.messageId as string | undefined) ?? null, threadId: null as string | null };
    } catch (err) {
      throw new IntegrationError(`SMTP (${cfg.host}): ${(err as Error).message}`);
    }
  }
  if (account.provider === "GOOGLE") {
    const res = await apiFetch<{ id: string; threadId: string }>(account, `${GOOGLE.gmailUrl()}/gmail/v1/users/me/messages/send`, {
      method: "POST",
      body: JSON.stringify({ raw: buildMime(account.email, e) }),
    });
    return { externalId: res.id as string | null, threadId: res.threadId as string | null };
  }
  await apiFetch(account, `${MICROSOFT.graphUrl()}/me/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: e.subject,
        body: { contentType: "Text", content: e.body },
        toRecipients: e.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: e.cc.map((address) => ({ emailAddress: { address } })),
        ...(e.replyTo ? { replyTo: [{ emailAddress: { address: e.replyTo } }] } : {}),
      },
      saveToSentItems: true,
    }),
  });
  // Graph's sendMail returns no id; the sent copy is matched on the next sync.
  return { externalId: null, threadId: null };
}
