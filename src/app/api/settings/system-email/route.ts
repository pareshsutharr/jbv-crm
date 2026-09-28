import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getCompanyProfile } from "@/lib/company";
import { decrypt, encrypt } from "@/lib/crypto";
import { verifySmtp } from "@/lib/integrations/mail";
import { IntegrationError } from "@/lib/integrations/oauth";
import { prisma } from "@/lib/prisma";
import { impliedSecure } from "@/lib/smtp-presets";
import { handle, HttpError, requireApiUser } from "@/lib/session";
import { sendSystemEmail, systemSender } from "@/lib/system-mail";
import { optionalText } from "@/lib/validation";

const smtpSchema = z.object({
  host: z.string().trim().min(1, "SMTP host is required").max(200),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  user: optionalText(200),
  /** Blank keeps the stored password. */
  pass: optionalText(500),
  from: z.string().trim().toLowerCase().email("Enter the From address, e.g. admin@beipoready.com"),
  secure: z.coerce.boolean().default(false),
});

const schema = z.object({
  /** Which admin's connected mailbox sends system email. */
  systemSenderUserId: z.string().nullable().optional(),
  /** SMTP fallback; `null` removes the stored settings. */
  smtp: smtpSchema.nullable().optional(),
});

export const maxDuration = 30; // SMTP checks can take a few seconds

export async function PATCH(req: Request) {
  return handle(async () => {
    const admin = await requireApiUser("settings:manage");
    const raw = await req.json();
    const input = schema.parse(raw);
    const data: Record<string, unknown> = { updatedById: admin.id };
    const changes: Record<string, Prisma.InputJsonValue | null> = {};

    if ("systemSenderUserId" in raw) {
      if (input.systemSenderUserId) {
        const u = await prisma.user.findUnique({ where: { id: input.systemSenderUserId }, select: { role: true, active: true } });
        if (!u || !u.active || u.role !== "ADMIN") throw new HttpError(400, "The system sender must be an active administrator");
      }
      data.systemSenderUserId = input.systemSenderUserId ?? null;
      changes.systemSenderUserId = input.systemSenderUserId ?? null;
    }
    if ("smtp" in raw) {
      if (input.smtp === null) {
        Object.assign(data, { smtpHost: null, smtpPort: null, smtpUser: null, smtpPass: null, smtpFrom: null, smtpSecure: false });
        changes.smtp = "removed";
      } else if (input.smtp) {
        const s = input.smtp;
        const secure = impliedSecure(s.port, s.secure);
        // Check the login now so a wrong host / password is reported here, not on the first invitation.
        const existing = await prisma.companyProfile.findUnique({ where: { id: 1 }, select: { smtpPass: true } });
        const pass = s.pass || (existing?.smtpPass ? decrypt(existing.smtpPass) : null);
        if (s.user && pass) {
          try {
            await verifySmtp({ host: s.host, port: s.port, secure, user: s.user, pass });
          } catch (err) {
            if (err instanceof IntegrationError) throw new HttpError(400, err.message);
            throw err;
          }
        }
        Object.assign(data, { smtpHost: s.host, smtpPort: s.port, smtpUser: s.user, smtpFrom: s.from, smtpSecure: secure });
        if (s.pass) data.smtpPass = encrypt(s.pass);
        changes.smtp = { host: s.host, port: s.port, user: s.user, from: s.from, secure, password: s.pass ? "updated" : "unchanged" };
      }
    }
    await prisma.companyProfile.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(prisma, { entityType: "Settings", entityId: "system-email", action: "updated", userId: admin.id, metadata: changes });
    const sender = await systemSender();
    return NextResponse.json({ method: sender.method, fromEmail: sender.fromEmail, summary: sender.summary, smtp: sender.smtp });
  });
}

/** Sends a test email to the signed-in admin through the system mailbox. */
export async function POST() {
  return handle(async () => {
    const admin = await requireApiUser("settings:manage");
    const firm = await getCompanyProfile();
    const result = await sendSystemEmail({
      to: [admin.email],
      subject: `Test email from the ${firm.firmName} CRM`,
      body: `Hi ${admin.name.split(" ")[0]},\n\nThis is a test message from the ${firm.firmName} CRM. If you're reading it, invitation emails will be delivered the same way.\n\n— ${firm.firmName}`,
    });
    return NextResponse.json(result);
  });
}
