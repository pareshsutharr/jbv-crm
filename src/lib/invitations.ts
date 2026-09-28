import type { Prisma, Role } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getCompanyProfile } from "@/lib/company";
import { decrypt, encrypt } from "@/lib/crypto";
import { appUrl } from "@/lib/integrations/config";
import { ROLE_LABELS } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/session";
import { sendSystemEmail } from "@/lib/system-mail";
import { emailSchema, nameSchema, optionalText, passwordSchema } from "@/lib/validation";

export const INVITE_TTL_DAYS = 7;

export const inviteCreateSchema = z.object({
  email: emailSchema,
  name: optionalText(120),
  designation: optionalText(100),
  phone: optionalText(40),
  role: z.enum(["ADMIN", "COMPLIANCE", "RM", "VIEWER"]).default("RM"),
});

export const inviteAcceptSchema = z.object({
  token: z.string().trim().min(20).max(200),
  name: nameSchema,
  password: passwordSchema,
  designation: optionalText(100),
  whatsapp: optionalText(40),
  phone: optionalText(40),
});

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const inviteUrl = (token: string) => `${appUrl()}/invite/${token}`;

export const invitationInclude = {
  invitedBy: { select: { id: true, name: true, designation: true } },
  acceptedUser: { select: { id: true, name: true } },
} as const satisfies Prisma.InvitationInclude;

type Row = Prisma.InvitationGetPayload<{ include: typeof invitationInclude }>;

export type InvitationStatus = "pending" | "expired" | "accepted" | "revoked";

export function invitationStatus(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InvitationStatus {
  if (i.acceptedAt) return "accepted";
  if (i.revokedAt) return "revoked";
  if (i.expiresAt.getTime() < now.getTime()) return "expired";
  return "pending";
}

/** API shape. The link is only exposed while the invitation can still be used. */
export function toInvitationRow(i: Row) {
  const status = invitationStatus(i);
  return {
    id: i.id,
    email: i.email,
    name: i.name,
    designation: i.designation,
    phone: i.phone,
    role: i.role,
    status,
    inviteUrl: status === "pending" ? inviteUrl(decrypt(i.tokenEncrypted)) : null,
    expiresAt: i.expiresAt.toISOString(),
    sentAt: i.sentAt?.toISOString() ?? null,
    sentVia: i.sentVia,
    sendError: i.sendError,
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    acceptedUser: i.acceptedUser,
    invitedBy: i.invitedBy.name,
    createdAt: i.createdAt.toISOString(),
  };
}
export type InvitationRow = ReturnType<typeof toInvitationRow>;

/** Resolves a raw token from an invite link. 404 for unknown, 410 when it can no longer be used. */
export async function findInvitationByToken(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: invitationInclude });
  if (!inv) throw new HttpError(404, "This invitation link isn't valid. Check the link or ask your administrator for a new one.");
  const status = invitationStatus(inv);
  if (status === "accepted") throw new HttpError(410, "This invitation has already been used — sign in instead.");
  if (status === "revoked") throw new HttpError(410, "This invitation was withdrawn. Ask your administrator for a new one.");
  if (status === "expired") throw new HttpError(410, "This invitation has expired. Ask your administrator to resend it.");
  return inv;
}

/**
 * Creates a fresh invitation (any earlier pending invitation for the same
 * address is withdrawn, so only one link works at a time).
 */
export async function issueInvitation(data: z.infer<typeof inviteCreateSchema>, invitedById: string) {
  const active = await prisma.user.findUnique({ where: { email: data.email }, select: { active: true } });
  if (active?.active) throw new HttpError(409, "A user with this email already exists");
  const token = newToken();
  const inv = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { email: data.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.invitation.create({
      data: {
        email: data.email,
        name: data.name,
        designation: data.designation,
        phone: data.phone,
        role: data.role as Role,
        tokenHash: hashToken(token),
        tokenEncrypted: encrypt(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        invitedById,
      },
      include: invitationInclude,
    });
  });
  return inv;
}

/** Issues a new token and expiry for an existing invitation (resend). */
export async function refreshInvitation(id: string) {
  const token = newToken();
  return prisma.invitation.update({
    where: { id },
    data: { tokenHash: hashToken(token), tokenEncrypted: encrypt(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000), revokedAt: null, sendError: null },
    include: invitationInclude,
  });
}

export function inviteEmail(inv: Pick<Row, "email" | "name" | "role" | "invitedBy">, firmName: string, url: string) {
  const inviter = [inv.invitedBy.name, inv.invitedBy.designation].filter(Boolean).join(", ");
  return {
    subject: `You're invited to the ${firmName} CRM`,
    body: [
      `Hi ${inv.name?.split(" ")[0] || "there"},`,
      "",
      `${inviter} has invited you to join the ${firmName} CRM as ${ROLE_LABELS[inv.role]}.`,
      "",
      `Accept the invitation and set your password here (the link works for ${INVITE_TTL_DAYS} days):`,
      url,
      "",
      "After signing in you'll add your name and designation; emails and WhatsApp messages you send from the CRM go out from the firm's shared mailbox and WhatsApp, signed with your name.",
      "",
      "If you weren't expecting this, you can ignore this email.",
      "",
      `— ${firmName}`,
    ].join("\n"),
  };
}

/** Short version for a WhatsApp / chat message. */
export function inviteChatText(inv: Pick<Row, "name" | "role" | "invitedBy">, firmName: string, url: string) {
  return [
    `Hi ${inv.name?.split(" ")[0] || "there"}, ${inv.invitedBy.name} has invited you to the ${firmName} CRM as ${ROLE_LABELS[inv.role]}.`,
    `Set up your account here (valid ${INVITE_TTL_DAYS} days): ${url}`,
  ].join("\n");
}

/** Emails the invitation through the system mailbox and records the outcome. Never throws for delivery problems. */
export async function deliverInvitation(inv: Row) {
  const firm = await getCompanyProfile();
  const url = inviteUrl(decrypt(inv.tokenEncrypted));
  const result = await sendSystemEmail({ to: [inv.email], ...inviteEmail(inv, firm.firmName, url) });
  const updated = await prisma.invitation.update({
    where: { id: inv.id },
    data: result.sent ? { sentAt: new Date(), sentVia: result.via, sendError: null } : { sendError: result.reason },
    include: invitationInclude,
  });
  return { invitation: updated, result, url, chatText: inviteChatText(inv, firm.firmName, url) };
}
