import Link from "next/link";
import { getCompanyProfile } from "@/lib/company";
import { findInvitationByToken } from "@/lib/invitations";
import { ROLE_LABELS } from "@/lib/labels";
import { getCurrentUser, HttpError } from "@/lib/session";
import { AcceptForm } from "./accept-form";

/** Public landing page for an invitation link: set a password, then continue to onboarding. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [firm, me] = await Promise.all([getCompanyProfile(), getCurrentUser()]);
  let problem: string | null = null;
  let inv: Awaited<ReturnType<typeof findInvitationByToken>> | null = null;
  try {
    inv = await findInvitationByToken(token);
  } catch (err) {
    if (err instanceof HttpError) problem = err.message;
    else throw err;
  }
  if (!inv) {
    return (
      <div className="space-y-4" data-testid="invite-problem">
        <div>
          <h1 className="text-base font-semibold">This invitation can&apos;t be used</h1>
          <p className="mt-1 text-sm text-gray-600">{problem}</p>
        </div>
        <Link href="/login" className="inline-flex h-9 w-full items-center justify-center rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <AcceptForm
      token={token}
      firmName={firm.firmName}
      signedInAs={me?.email ?? null}
      invitation={{ email: inv.email, name: inv.name, designation: inv.designation, phone: inv.phone, role: ROLE_LABELS[inv.role], invitedBy: inv.invitedBy.name }}
    />
  );
}
