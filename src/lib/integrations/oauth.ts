import type { ConnectedAccount, IntegrationProvider } from "@prisma/client";
import { encrypt, tryDecrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { GOOGLE, MICROSOFT, redirectUri } from "./config";

export class IntegrationError extends Error {}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

export function authorizeUrl(provider: IntegrationProvider, state: string) {
  if (provider === "GOOGLE") {
    const qs = new URLSearchParams({
      client_id: GOOGLE.clientId()!,
      redirect_uri: redirectUri("GOOGLE"),
      response_type: "code",
      scope: GOOGLE.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${GOOGLE.authUrl()}?${qs}`;
  }
  const qs = new URLSearchParams({
    client_id: MICROSOFT.clientId()!,
    redirect_uri: redirectUri("MICROSOFT"),
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT.scopes.join(" "),
    prompt: "select_account",
    state,
  });
  return `${MICROSOFT.loginUrl()}/${MICROSOFT.tenant()}/oauth2/v2.0/authorize?${qs}`;
}

async function tokenRequest(provider: IntegrationProvider, params: Record<string, string>) {
  const url = provider === "GOOGLE" ? GOOGLE.tokenUrl() : `${MICROSOFT.loginUrl()}/${MICROSOFT.tenant()}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: provider === "GOOGLE" ? GOOGLE.clientId()! : MICROSOFT.clientId()!,
    client_secret: provider === "GOOGLE" ? GOOGLE.clientSecret()! : MICROSOFT.clientSecret()!,
    ...params,
  });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) throw new IntegrationError(data.error_description || data.error || `Token request failed (${res.status})`);
  return data;
}

async function fetchEmail(provider: IntegrationProvider, accessToken: string) {
  const url = provider === "GOOGLE" ? `${GOOGLE.apiUrl()}/oauth2/v3/userinfo` : `${MICROSOFT.graphUrl()}/me`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = (await res.json().catch(() => ({}))) as { email?: string; mail?: string; userPrincipalName?: string };
  const email = data.email ?? data.mail ?? data.userPrincipalName;
  if (!res.ok || !email) throw new IntegrationError("Could not read the account's email address");
  return email.toLowerCase();
}

/** Completes the OAuth code exchange and stores (encrypted) tokens for the user. */
export async function connectAccount(userId: string, provider: IntegrationProvider, code: string) {
  const tokens = await tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    ...(provider === "MICROSOFT" ? { scope: MICROSOFT.scopes.join(" ") } : {}),
  });
  const email = await fetchEmail(provider, tokens.access_token);
  const data = {
    email,
    accessToken: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    scopes: tokens.scope ?? null,
    syncError: null,
  };
  return prisma.connectedAccount.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...data, accessToken: data.accessToken },
    update: data,
  });
}

/** A valid access token for the account, refreshing it when it's about to expire. */
export async function accessTokenFor(account: ConnectedAccount) {
  if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) {
    const token = tryDecrypt(account.accessToken);
    if (!token) throw new IntegrationError("The stored connection can't be read on this deployment — reconnect the account");
    return token;
  }
  const refresh = tryDecrypt(account.refreshToken);
  if (!refresh) throw new IntegrationError("The connection has expired — reconnect the account");
  const tokens = await tokenRequest(account.provider, {
    grant_type: "refresh_token",
    refresh_token: refresh,
    ...(account.provider === "MICROSOFT" ? { scope: MICROSOFT.scopes.join(" ") } : {}),
  });
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(tokens.access_token),
      ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    },
  });
  return tokens.access_token;
}

/** Authenticated JSON fetch against a provider API. */
export async function apiFetch<T = unknown>(account: ConnectedAccount, url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessTokenFor(account);
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 204 || res.status === 202) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data as { error?: { message?: string } | string };
    const message = typeof e.error === "string" ? e.error : e.error?.message;
    throw new IntegrationError(message || `${account.provider === "GOOGLE" ? "Google" : "Microsoft"} API error (${res.status})`);
  }
  return data as T;
}
