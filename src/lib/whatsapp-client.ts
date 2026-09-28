/**
 * Client for the firm's WhatsApp service (whatsapp/server.mjs): a separate
 * Node process, run under pm2, that holds the linked WhatsApp session so it
 * survives CRM redeploys. The CRM talks to it over HTTP with a shared token.
 *
 *   WHATSAPP_SERVICE_URL    e.g. http://127.0.0.1:3018 (same server) or https://wa.example.com (CRM on Vercel)
 *   WHATSAPP_SERVICE_TOKEN  shared secret
 *
 * Without both, WhatsApp is "off": the UI falls back to wa.me links, and staff
 * alerts fall back to CallMeBot (see callmebot.ts).
 */
import { normalisePhoneForWhatsApp } from "@/lib/whatsapp";

export class WhatsAppError extends Error {}

export type WhatsAppMode = "service" | "off";
export type WhatsAppStatus = "disconnected" | "connecting" | "qr" | "connected";
export type FirmWhatsApp = { status: WhatsAppStatus; phone: string | null; qr: string | null; error: string | null; connectedAt: string | null; queued: number; mode: WhatsAppMode; available: boolean };
export type SendResult = { sent: boolean; queued: boolean; id: string | null; to: string };

export function whatsappMode(): WhatsAppMode {
  return process.env.WHATSAPP_SERVICE_URL && process.env.WHATSAPP_SERVICE_TOKEN ? "service" : "off";
}
export const WHATSAPP_UNAVAILABLE = "The firm's WhatsApp service isn't configured on this deployment (WHATSAPP_SERVICE_URL / WHATSAPP_SERVICE_TOKEN). Messages open in your WhatsApp app instead.";

async function service<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.WHATSAPP_SERVICE_URL!.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.WHATSAPP_SERVICE_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(28_000), cache: "no-store" });
  } catch (err) {
    throw new WhatsAppError(`WhatsApp service unreachable (${base}): ${(err as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new WhatsAppError(data.error ?? `WhatsApp service error (${res.status})`);
  return data;
}

const off = (): FirmWhatsApp => ({ status: "disconnected", phone: null, qr: null, error: null, connectedAt: null, queued: 0, mode: "off", available: false });

export async function firmWhatsappStatus(): Promise<FirmWhatsApp> {
  if (whatsappMode() === "off") return off();
  try {
    const s = await service<Omit<FirmWhatsApp, "mode" | "available">>("/status");
    return { ...s, queued: s.queued ?? 0, mode: "service", available: true };
  } catch (err) {
    return { status: "disconnected", phone: null, qr: null, error: (err as Error).message, connectedAt: null, queued: 0, mode: "service", available: true };
  }
}

/** Admin: start linking — the service forgets any old session and hands out a QR code. */
export async function startFirmWhatsApp(): Promise<FirmWhatsApp> {
  if (whatsappMode() === "off") throw new WhatsAppError(WHATSAPP_UNAVAILABLE);
  const s = await service<Omit<FirmWhatsApp, "mode" | "available">>("/link", { method: "POST" });
  return { ...s, queued: s.queued ?? 0, mode: "service", available: true };
}

/** Admin: unlink (logs out on the phone; the service forgets the session). */
export async function stopFirmWhatsApp() {
  if (whatsappMode() === "off") return;
  await service("/unlink", { method: "POST" });
}

/** true when the firm's WhatsApp is linked (connected, or paired and reconnecting). */
export async function firmWhatsappLinked() {
  if (whatsappMode() === "off") return false;
  try {
    const s = await service<{ status: WhatsAppStatus }>("/status");
    return s.status === "connected" || s.status === "connecting";
  } catch {
    return false;
  }
}

/** Sends a text from the firm's WhatsApp. The service paces messages 3–7 s apart; a long queue answers `queued`. */
export async function sendFirmWhatsAppText(phone: string, text: string): Promise<SendResult> {
  if (whatsappMode() === "off") throw new WhatsAppError(WHATSAPP_UNAVAILABLE);
  const digits = normalisePhoneForWhatsApp(phone);
  if (!digits) throw new WhatsAppError("Enter a valid phone number with country code");
  const r = await service<{ sent?: boolean; queued?: boolean; id?: string | null; to?: string }>("/send", { method: "POST", body: JSON.stringify({ phone: `+${digits}`, text }) });
  return { sent: !!r.sent, queued: !!r.queued, id: r.id ?? null, to: r.to ?? `+${digits}` };
}
