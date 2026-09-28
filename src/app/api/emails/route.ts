import { NextResponse } from "next/server";
import { z } from "zod";
import { assertCanAccessParent } from "@/lib/interactions";
import { IntegrationError } from "@/lib/integrations/oauth";
import { recordSentEmail, sendAsUser } from "@/lib/outgoing-mail";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";

export const maxDuration = 30; // may send email through SMTP / provider APIs

const emails = z.array(z.string().trim().toLowerCase().email("Invalid email address")).max(30);
const sendSchema = z
  .object({
    to: emails.min(1, "Add at least one recipient"),
    cc: emails.default([]),
    subject: z.string().trim().min(1, "Subject is required").max(300),
    body: z.string().trim().min(1, "Write a message").max(20000),
    leadId: z.string().optional().nullable().transform((v) => v || null),
    clientId: z.string().optional().nullable().transform((v) => v || null),
  })
  .refine((v) => !!v.leadId !== !!v.clientId, "Send from a lead or client page");

/** Email thread list for a lead/client. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser("leads:view");
    const sp = new URL(req.url).searchParams;
    const leadId = sp.get("leadId");
    const clientId = sp.get("clientId");
    await assertCanAccessParent(user, { leadId, clientId });
    const messages = await prisma.emailMessage.findMany({
      where: clientId ? { clientId } : { leadId },
      include: { user: { select: { name: true } } },
      orderBy: { sentAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ messages });
  });
}

/** Send an email from the firm mailbox as the signed-in user; it's stored on the record's timeline immediately. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser("emails:send");
    const input = sendSchema.parse(await req.json());
    await assertCanAccessParent(user, input);
    let sent;
    try {
      sent = await sendAsUser(user, { to: input.to, cc: input.cc, subject: input.subject, body: input.body });
    } catch (err) {
      if (err instanceof IntegrationError) throw new HttpError(err.message.includes("isn't set up") ? 400 : 502, err.message);
      throw err;
    }
    const message = await recordSentEmail(prisma, { user, sent, subject: input.subject, body: input.body, to: input.to, cc: input.cc, leadId: input.leadId, clientId: input.clientId });
    return NextResponse.json({ message }, { status: 201 });
  });
}
