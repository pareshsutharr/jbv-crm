import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";
import { type FirmWhatsApp, firmWhatsappStatus, startFirmWhatsApp, stopFirmWhatsApp, WhatsAppError } from "@/lib/whatsapp-client";

export const maxDuration = 30;

async function withQrImage(s: FirmWhatsApp) {
  return { ...s, qr: s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 280 }) : null };
}

/** The firm's WhatsApp link status (from the WhatsApp service); while linking, carries the QR code as a data URL. */
export async function GET() {
  return handle(async () => {
    await requireApiUser();
    return NextResponse.json(await withQrImage(await firmWhatsappStatus()));
  });
}

/** Admin: start linking the firm's WhatsApp — scan the QR from WhatsApp → Linked devices. */
export async function POST() {
  return handle(async () => {
    const admin = await requireApiUser("settings:manage");
    let s: FirmWhatsApp;
    try {
      s = await startFirmWhatsApp();
    } catch (err) {
      if (err instanceof WhatsAppError) throw new HttpError(502, err.message);
      throw err;
    }
    for (let i = 0; i < 20 && s.status === "connecting"; i++) {
      await new Promise((r) => setTimeout(r, 400));
      s = await firmWhatsappStatus();
    }
    await audit(prisma, { entityType: "Settings", entityId: "whatsapp", action: "link_started", userId: admin.id });
    return NextResponse.json(await withQrImage(s));
  });
}

/** Admin: unlink the firm's WhatsApp (logs out on the phone and forgets the credentials). */
export async function DELETE() {
  return handle(async () => {
    const admin = await requireApiUser("settings:manage");
    try {
      await stopFirmWhatsApp();
    } catch (err) {
      if (err instanceof WhatsAppError) throw new HttpError(502, err.message);
      throw err;
    }
    await audit(prisma, { entityType: "Settings", entityId: "whatsapp", action: "unlinked", userId: admin.id });
    return NextResponse.json({ ok: true });
  });
}
