import { NextResponse } from "next/server";
import { z } from "zod";
import { assertCanAccessParent } from "@/lib/interactions";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";
import { optionalText } from "@/lib/validation";
import { normalisePhoneForWhatsApp, whatsappUrl } from "@/lib/whatsapp";
import { firmWhatsappLinked, sendFirmWhatsAppText, WhatsAppError } from "@/lib/whatsapp-client";

const schema = z
  .object({
    leadId: z.string().optional().nullable().transform((v) => v || null),
    clientId: z.string().optional().nullable().transform((v) => v || null),
    phone: z.string().trim().min(6).max(40),
    name: optionalText(120),
    text: z.string().trim().min(1, "Write a message").max(4000),
  })
  .refine((v) => !!v.leadId !== !!v.clientId, "Send from a lead or client page");

export const maxDuration = 30;

/**
 * Sends a WhatsApp message to a lead / client contact from the firm's linked
 * WhatsApp (direct). When it isn't linked, returns a wa.me link the browser
 * opens so the message goes from the user's phone. Logged either way.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser("interactions:log");
    const input = schema.parse(await req.json());
    await assertCanAccessParent(user, input);
    const digits = normalisePhoneForWhatsApp(input.phone);
    if (!digits) throw new HttpError(400, "Enter a valid phone number with country code");
    const who = input.name ? `${input.name} (+${digits})` : `+${digits}`;

    if (await firmWhatsappLinked()) {
      let r;
      try {
        r = await sendFirmWhatsAppText(input.phone, input.text);
      } catch (err) {
        if (err instanceof WhatsAppError) throw new HttpError(502, err.message);
        throw err;
      }
      await prisma.interaction.create({
        data: { type: "WHATSAPP", occurredAt: new Date(), summary: `WhatsApp to ${who} (${r.queued ? "queued on" : "sent from"} the firm's WhatsApp by ${user.name}):\n${input.text}`.slice(0, 5000), leadId: input.leadId, clientId: input.clientId, loggedById: user.id },
      });
      return NextResponse.json({ direct: true, queued: r.queued, to: r.to });
    }
    await prisma.interaction.create({
      data: { type: "WHATSAPP", occurredAt: new Date(), summary: `WhatsApp to ${who} (opened in WhatsApp):\n${input.text}`.slice(0, 5000), leadId: input.leadId, clientId: input.clientId, loggedById: user.id },
    });
    return NextResponse.json({ direct: false, to: `+${digits}`, url: whatsappUrl(input.text, input.phone) });
  });
}
