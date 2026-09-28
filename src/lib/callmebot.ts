/**
 * CallMeBot (api.callmebot.com): a free WhatsApp API for a recipient's OWN
 * number. Each staff member registers once by sending
 * "I allow callmebot to send me messages" to CallMeBot's WhatsApp number
 * (see https://www.callmebot.com/blog/free-api-whatsapp-messages/) and gets
 * an API key. Used only as the fallback for staff alerts when the firm's
 * WhatsApp service isn't linked — it can't message clients.
 */
import { normalisePhoneForWhatsApp } from "@/lib/whatsapp";

export async function sendCallMeBot(phone: string, apikey: string, text: string) {
  const digits = normalisePhoneForWhatsApp(phone);
  if (!digits) throw new Error("Invalid phone number");
  const base = process.env.CALLMEBOT_URL ?? "https://api.callmebot.com/whatsapp.php";
  const url = `${base}?phone=${digits}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const body = await res.text();
  if (!res.ok || /apikey.*(invalid|wrong)|not (registered|activated)|error/i.test(body)) throw new Error(`CallMeBot: ${body.replace(/<[^>]+>/g, " ").trim().slice(0, 160) || res.status}`);
  return { to: `+${digits}` };
}
