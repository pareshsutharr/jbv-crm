import type { IntegrationProvider } from "@prisma/client";

/**
 * OAuth / API endpoints. Every base URL can be overridden by env, which the
 * e2e suite uses to point at a local mock of Google and Microsoft.
 */
export const GOOGLE = {
  clientId: () => process.env.GOOGLE_CLIENT_ID,
  clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  authUrl: () => process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: () => process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
  apiUrl: () => process.env.GOOGLE_API_URL ?? "https://www.googleapis.com",
  gmailUrl: () => process.env.GOOGLE_GMAIL_URL ?? "https://gmail.googleapis.com",
  scopes: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
};

export const MICROSOFT = {
  clientId: () => process.env.MICROSOFT_CLIENT_ID,
  clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
  tenant: () => process.env.MICROSOFT_TENANT_ID || "common",
  loginUrl: () => process.env.MICROSOFT_LOGIN_URL ?? "https://login.microsoftonline.com",
  graphUrl: () => process.env.MICROSOFT_GRAPH_URL ?? "https://graph.microsoft.com/v1.0",
  scopes: ["offline_access", "openid", "email", "User.Read", "Mail.Read", "Mail.Send", "Calendars.ReadWrite"],
};

export function providerConfigured(p: IntegrationProvider) {
  if (p === "SMTP") return true; // needs no server-side setup: the user enters an app password
  return p === "GOOGLE" ? !!(GOOGLE.clientId() && GOOGLE.clientSecret()) : !!(MICROSOFT.clientId() && MICROSOFT.clientSecret());
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = { GOOGLE: "Google (Gmail & Meet)", MICROSOFT: "Microsoft (Outlook & Teams)", SMTP: "Email (app password)" };
export const PROVIDER_SHORT: Record<IntegrationProvider, string> = { GOOGLE: "Gmail", MICROSOFT: "Outlook", SMTP: "Email" };

/** Public base URL: NEXTAUTH_URL, else the Vercel production domain, else the current deployment. */
export function appUrl() {
  const fromVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return (process.env.NEXTAUTH_URL ?? (fromVercel ? `https://${fromVercel}` : "http://localhost:3000")).replace(/\/$/, "");
}

export const redirectUri = (p: IntegrationProvider) => `${appUrl()}/api/integrations/${p.toLowerCase()}/callback`;
