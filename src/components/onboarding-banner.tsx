"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Shown until an invited user completes the onboarding checklist. */
export function OnboardingBanner() {
  const pathname = usePathname();
  if (pathname.startsWith("/onboarding")) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-100 bg-gold-50 px-8 py-2 text-sm text-gray-800" data-testid="onboarding-banner">
      <span>Finish setting up your account so meeting links, emails and WhatsApp messages go out from your own accounts.</span>
      <Link href="/onboarding" className="font-medium text-brand-600 hover:underline">
        Finish setup →
      </Link>
    </div>
  );
}
