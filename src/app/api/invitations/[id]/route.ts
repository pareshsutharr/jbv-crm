import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { deliverInvitation, refreshInvitation, toInvitationRow } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { handle, HttpError, requireApiUser } from "@/lib/session";

export const maxDuration = 30; // may send email through SMTP / provider APIs

/** Resend: issues a fresh link (the old one stops working) and emails it again. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireApiUser("users:manage");
    const { id } = await params;
    const existing = await prisma.invitation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Invitation not found");
    if (existing.acceptedAt) throw new HttpError(400, "This invitation has already been accepted");
    const refreshed = await refreshInvitation(id);
    await audit(prisma, { entityType: "Invitation", entityId: id, action: "resent", userId: admin.id, metadata: { email: refreshed.email } });
    const { invitation, result, url, chatText } = await deliverInvitation(refreshed);
    return NextResponse.json({ invitation: toInvitationRow(invitation), inviteUrl: url, chatText, sent: result.sent, sendError: result.sent ? null : result.reason });
  });
}

/** Revoke: the link stops working immediately. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireApiUser("users:manage");
    const { id } = await params;
    const existing = await prisma.invitation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Invitation not found");
    if (existing.acceptedAt) throw new HttpError(400, "This invitation has already been accepted — deactivate the user instead");
    await prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(prisma, { entityType: "Invitation", entityId: id, action: "revoked", userId: admin.id, metadata: { email: existing.email } });
    return NextResponse.json({ ok: true });
  });
}
