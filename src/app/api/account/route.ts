import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, diff } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";
import { nameSchema, optionalText } from "@/lib/validation";
import { normalisePhoneForWhatsApp } from "@/lib/whatsapp";

const schema = z.object({
  name: nameSchema.optional(),
  designation: optionalText(100),
  phone: optionalText(40),
  whatsapp: optionalText(40),
  meetingLink: z
    .union([z.literal(""), z.string().trim().url("Enter a full link, e.g. https://zoom.us/j/…")])
    .optional()
    .nullable()
    .transform((v) => v || null),
  /** CallMeBot API key for WhatsApp alerts when the firm's WhatsApp isn't linked. */
  callMeBotKey: optionalText(200),
  /** Receive WhatsApp alerts for new website enquiries. */
  whatsappAlerts: z.boolean().optional(),
  /** true when the user finishes the onboarding checklist. */
  onboarded: z.boolean().optional(),
});

/** Self-service profile: name, designation and the user's own channels (WhatsApp, phone, personal meeting link). */
export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireApiUser();
    const raw = await req.json();
    const input = schema.parse(raw);
    if (input.whatsapp && !normalisePhoneForWhatsApp(input.whatsapp)) throw new HttpError(400, "Enter a valid WhatsApp number with country code, e.g. +91 98200 12345");

    const { onboarded, ...fields } = input;
    // Only touch fields that were actually sent, so the onboarding steps can save independently.
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) if (key in raw) data[key] = fields[key];
    if (onboarded) data.onboardedAt = new Date();

    const before = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    const user = await prisma.user.update({
      where: { id: me.id },
      data,
      select: { id: true, name: true, email: true, role: true, designation: true, phone: true, whatsapp: true, meetingLink: true, callMeBotKey: true, whatsappAlerts: true, onboardedAt: true },
    });
    const changes = diff(before, data);
    if (Object.keys(changes).length) await audit(prisma, { entityType: "User", entityId: me.id, action: "profile_updated", userId: me.id, metadata: changes as unknown as Prisma.InputJsonValue });
    return NextResponse.json({ user });
  });
}
