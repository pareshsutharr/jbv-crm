import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/company";
import { findInvitationByToken } from "@/lib/invitations";
import { handle } from "@/lib/session";

/** Public: what the invitee sees before accepting (no secrets). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await params;
    const [inv, firm] = await Promise.all([findInvitationByToken(token), getCompanyProfile()]);
    return NextResponse.json({
      invitation: { email: inv.email, name: inv.name, designation: inv.designation, phone: inv.phone, role: inv.role, invitedBy: inv.invitedBy.name, expiresAt: inv.expiresAt.toISOString() },
      firmName: firm.firmName,
    });
  });
}
