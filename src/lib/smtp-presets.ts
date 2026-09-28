/**
 * Known SMTP settings for common email providers (isomorphic: used by the
 * forms and by the server). Port 465 means implicit TLS; 587 uses STARTTLS.
 */
export type SmtpPreset = { id: string; label: string; host: string; port: number; secure: boolean; domains?: RegExp; help: string };

export const SMTP_PRESETS: SmtpPreset[] = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    domains: /^(gmail|googlemail)\.com$/,
    help: "Google Account → Security → 2-Step Verification → App passwords. Works for Google Workspace addresses too.",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    domains: /^(outlook|hotmail|live|msn)\.(com|in|co\.uk)$/,
    help: "Outlook.com: Microsoft account → Security → App passwords. Microsoft 365: your admin must allow SMTP AUTH for the mailbox.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    host: "smtp.zoho.in",
    port: 465,
    secure: true,
    domains: /^zoho(mail)?\.(com|in)$/,
    help: "Zoho Mail → Settings → Security → App passwords. Accounts hosted on zoho.com (outside India) use smtp.zoho.com.",
  },
  {
    id: "titan",
    label: "Titan Mail",
    host: "smtp.titan.email",
    port: 465,
    secure: true,
    domains: /^titan\.email$/,
    help: "Your full Titan email address and its password (Titan has no separate app password).",
  },
  {
    id: "godaddy",
    label: "GoDaddy Professional Email",
    host: "smtpout.secureserver.net",
    port: 465,
    secure: true,
    help: "Your GoDaddy email address and its password.",
  },
  { id: "yahoo", label: "Yahoo", host: "smtp.mail.yahoo.com", port: 465, secure: true, domains: /^yahoo\.(com|co\.in|in)$/, help: "Yahoo → Account security → Generate app password." },
  { id: "icloud", label: "iCloud", host: "smtp.mail.me.com", port: 587, secure: false, domains: /^(icloud|me|mac)\.com$/, help: "Apple ID → Sign-In and Security → App-Specific Passwords." },
  { id: "rediff", label: "Rediffmail", host: "smtp.rediffmail.com", port: 465, secure: true, domains: /^rediffmail\.com$/, help: "Your Rediffmail address and password." },
];

/** The preset for a public mailbox domain, if any (custom domains need the provider chosen by hand). */
export function detectSmtpPreset(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return SMTP_PRESETS.find((p) => p.domains?.test(domain)) ?? null;
}

export const smtpPresetById = (id: string | null | undefined) => SMTP_PRESETS.find((p) => p.id === id) ?? null;
export const smtpPresetByHost = (host: string | null | undefined) => SMTP_PRESETS.find((p) => p.host === host?.trim().toLowerCase()) ?? null;

/** Port 465 is always implicit TLS; anything else negotiates STARTTLS. */
export const impliedSecure = (port: number, secure?: boolean | null) => port === 465 || !!secure;
