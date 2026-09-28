import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyState } from "@/lib/crypto";
import { appUrl } from "@/lib/integrations/config";
import { connectAccount } from "@/lib/integrations/oauth";
import { parseProvider } from "@/lib/integrations/provider-param";
import { getCurrentUser } from "@/lib/session";

/** OAuth redirect target: validates state + nonce, exchanges the code and stores the connection. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const url = new URL(req.url);
  const state = verifyState<{ uid: string; p: string; n: string; r?: string }>(url.searchParams.get("state"));
  const dest = state?.r === "onboarding" ? "onboarding" : "account";
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl()}/${dest}?${q}`);
    res.cookies.delete({ name: "oauth_nonce", path: "/api/integrations" });
    return res;
  };
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  if (url.searchParams.get("error")) return back(`error=${encodeURIComponent(url.searchParams.get("error")!)}`);

  let provider;
  try {
    provider = parseProvider((await params).provider);
  } catch {
    return back("error=unknown_provider");
  }
  if (provider === "SMTP") return back("error=unknown_provider");
  const nonce = (await cookies()).get("oauth_nonce")?.value;
  if (!state || state.uid !== user.id || state.p !== provider || !nonce || state.n !== nonce) return back("error=invalid_state");
  const code = url.searchParams.get("code");
  if (!code) return back("error=missing_code");
  try {
    await connectAccount(user.id, provider, code);
  } catch (err) {
    return back(`error=${encodeURIComponent((err as Error).message)}`);
  }
  return back(`connected=${provider.toLowerCase()}`);
}
