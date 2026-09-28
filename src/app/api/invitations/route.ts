import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { deliverInvitation, invitationInclude, inviteCreateSchema, issueInvitation, toInvitationRow } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { handle, requireApiUser } from "@/lib/session";

export const maxDuration = 30; // may send email through SMTP / provider APIs

/** Open invitations (plus those accepted in the last 14 days, for context). */
export async function GET() {
  return handle(async () => {
    await requireApiUser("users:manage");
    const invitations = await prisma.invitation.findMany({
      where: { OR: [{ acceptedAt: null }, { acceptedAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }] },
      include: invitationInclude,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ invitations: invitations.map(toInvitationRow) });
  });
}

/**
 * Invite someone to the CRM. The invitation email goes out from the system
 * mailbox; if that isn't set up the response still carries the link so the
 * admin can share it by hand (copy / WhatsApp).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireApiUser("users:manage");
    const input = inviteCreateSchema.parse(await req.json());
    const inv = await issueInvitation(input, admin.id);
    await audit(prisma, { entityType: "Invitation", entityId: inv.id, action: "created", userId: admin.id, metadata: { email: inv.email, role: inv.role } });
    const { invitation, result, url, chatText } = await deliverInvitation(inv);
    return NextResponse.json(
      { invitation: toInvitationRow(invitation), inviteUrl: url, chatText, sent: result.sent, sendError: result.sent ? null : result.reason },
      { status: 201 },
    );
  });
}
