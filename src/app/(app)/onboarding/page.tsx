import { PageBody, PageHeader } from "@/components/layout";
import { getCompanyProfile } from "@/lib/company";
import type { SearchParams } from "@/lib/filters";
import { providerConfigured } from "@/lib/integrations/config";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/session";
import { OnboardingChecklist } from "./onboarding-checklist";

/** First-run checklist for invited users: details → connect mailbox → WhatsApp & meeting link. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const [me, accounts, firm] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, designation: true, phone: true, whatsapp: true, meetingLink: true, onboardedAt: true } }),
    prisma.connectedAccount.findMany({ where: { userId: user.id, provider: { in: ["GOOGLE", "MICROSOFT"] } }, select: { provider: true, email: true } }),
    getCompanyProfile(),
  ]);
  const connected = typeof sp.connected === "string" ? sp.connected : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <>
      <PageHeader
        title={`Welcome to ${firm.firmName}, ${me.name.split(" ")[0]}`}
        description={`A minute to set up your profile. Emails and WhatsApp messages you send from the CRM go out from ${firm.firmName}'s shared mailbox and WhatsApp — nothing to connect.`}
      />
      <PageBody className="max-w-3xl space-y-5">
        {connected && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Connected your {connected === "google" ? "Google" : "Microsoft"} account.</p>}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.endsWith("_not_configured")
              ? `${error.startsWith("google") ? "Google" : "Microsoft"} sign-in isn't set up on this server yet. Ask an admin to add the OAuth client ID and secret — you can skip this step for now.`
              : `Couldn't connect: ${error.replace(/_/g, " ")}`}
          </p>
        )}
        <OnboardingChecklist
          me={{ ...me, onboardedAt: me.onboardedAt?.toISOString() ?? null }}
          accounts={accounts.map((a) => ({ provider: a.provider as "GOOGLE" | "MICROSOFT", email: a.email }))}
          configured={{ GOOGLE: providerConfigured("GOOGLE"), MICROSOFT: providerConfigured("MICROSOFT") }}
        />
      </PageBody>
    </>
  );
}
