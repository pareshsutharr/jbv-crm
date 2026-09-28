import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { signState } from "@/lib/crypto";
import { appUrl, providerConfigured } from "@/lib/integrations/config";
import { authorizeUrl } from "@/lib/integrations/oauth";
import { parseProvider } from "@/lib/integrations/provider-param";
import { getCurrentUser } from "@/lib/session";

/** Starts the OAuth flow to connect the signed-in user's Google / Microsoft account. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  // Where to land afterwards: My account (default) or the onboarding checklist.
  const ret = new URL(req.url).searchParams.get("return") === "onboarding" ? "onboarding" : "account";
  let provider;
  try {
    provider = parseProvider((await params).provider);
  } catch {
    return NextResponse.redirect(`${appUrl()}/${ret}?error=unknown_provider`);
  }
  if (provider === "SMTP") return NextResponse.redirect(`${appUrl()}/${ret}?error=add_your_email_with_an_app_password_instead`);
  if (!providerConfigured(provider)) return NextResponse.redirect(`${appUrl()}/${ret}?error=${provider.toLowerCase()}_not_configured`);
  const nonce = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(provider, signState({ uid: user.id, p: provider, n: nonce, r: ret })));
  res.cookies.set("oauth_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: appUrl().startsWith("https"), maxAge: 600, path: "/api/integrations" });
  return res;
}
