import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { findInvitationByToken, inviteAcceptSchema } from "@/lib/invitations";
import { ROLE_LABELS } from "@/lib/labels";
import { notify } from "@/lib/notifications";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { handle, HttpError } from "@/lib/session";
import { normalisePhoneForWhatsApp } from "@/lib/whatsapp";

/**
 * Public: the invitee sets their name and password. The account is created
 * active with the invited role; the client then signs in and is sent to the
 * onboarding checklist (connect mailbox, add WhatsApp).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const input = inviteAcceptSchema.parse(await req.json());
    if (input.whatsapp && !normalisePhoneForWhatsApp(input.whatsapp)) throw new HttpError(400, "Enter a valid WhatsApp number, e.g. +91 98200 12345");
    const inv = await findInvitationByToken(input.token);
    const passwordHash = await hashPassword(input.password);

    const user = await prisma.$transaction(async (tx) => {
      // Claim the invitation first so a link can only ever be used once.
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new HttpError(410, "This invitation has already been used — sign in instead.");

      const existing = await tx.user.findUnique({ where: { email: inv.email } });
      if (existing?.active) throw new HttpError(409, "An account with this email already exists — sign in instead.");
      const data = {
        name: input.name,
        passwordHash,
        role: inv.role,
        active: true,
        designation: input.designation ?? inv.designation,
        whatsapp: input.whatsapp,
        phone: input.phone ?? inv.phone,
      };
      // A pending self-signup with the same address is upgraded rather than duplicated.
      const u = existing ? await tx.user.update({ where: { id: existing.id }, data }) : await tx.user.create({ data: { email: inv.email, ...data } });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedUserId: u.id } });
      await audit(tx, { entityType: "User", entityId: u.id, action: "invitation_accepted", userId: u.id, metadata: { invitationId: inv.id, invitedById: inv.invitedById, role: inv.role } });
      await notify(tx, [inv.invitedById], {
        type: "USER_JOINED",
        title: `${u.name} accepted your invitation`,
        body: `${ROLE_LABELS[u.role]} · ${u.email}`,
        link: "/users",
        dedupeKey: `user-joined:${u.id}`,
      });
      return u;
    });
    return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
  });
}
