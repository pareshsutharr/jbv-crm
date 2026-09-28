import { Card, PageBody, PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import type { SearchParams } from "@/lib/filters";
import { formatDateTime } from "@/lib/format";
import { PROVIDER_LABELS, providerConfigured } from "@/lib/integrations/config";
import { ROLE_LABELS } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/session";
import Link from "next/link";
import { firmMailbox } from "@/lib/outgoing-mail";
import { IntegrationActions } from "./integration-actions";
import { ProfileForm } from "./profile-form";

const PROVIDERS = ["GOOGLE", "MICROSOFT"] as const;
const WHAT: Record<(typeof PROVIDERS)[number], string> = {
  GOOGLE: "Create Google Meet invites from the CRM, and capture Gmail conversations with your leads and clients.",
  MICROSOFT: "Create Microsoft Teams invites from the CRM, and capture Outlook conversations with your leads and clients.",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const [accounts, me, mailbox] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId: user.id, provider: { in: ["GOOGLE", "MICROSOFT"] } } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, designation: true, phone: true, whatsapp: true, meetingLink: true, callMeBotKey: true, whatsappAlerts: true, onboardedAt: true } }),
    firmMailbox(),
  ]);
  const connected = typeof sp.connected === "string" ? sp.connected : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <>
      <PageHeader title="My account" description={`${user.name}${me.designation ? `, ${me.designation}` : ""} · ${user.email} · ${ROLE_LABELS[user.role]}`} />
      <PageBody className="max-w-3xl space-y-5">
        {!me.onboardedAt && (
          <p className="rounded-md bg-gold-50 px-3 py-2 text-sm text-gray-800">
            You haven&apos;t finished the setup checklist yet.{" "}
            <Link href="/onboarding" className="font-medium text-brand-600 underline">
              Finish setup
            </Link>
          </p>
        )}
        <Card title="Profile & my channels">
          <ProfileForm initial={me} fields={["name", "designation", "phone", "whatsapp", "meetingLink", "whatsappAlerts", "callMeBotKey"]} submitLabel="Save profile" />
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            {mailbox
              ? `Emails and meeting invitations you send from the CRM go out from the firm mailbox ${mailbox.from} as "${user.name} via ${mailbox.firmName}", and replies come to ${user.email}.`
              : "Emails from the CRM are sent from the firm mailbox once an administrator sets it up under Settings → System email."}{" "}
            WhatsApp messages go out from the firm&apos;s WhatsApp when it is linked; your designation and number appear in the signature.
          </p>
        </Card>
        {connected && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Connected your {connected === "google" ? "Google" : "Microsoft"} account.</p>}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.endsWith("_not_configured")
              ? `${error.startsWith("google") ? "Google" : "Microsoft"} sign-in isn't set up on this server yet. Ask an admin to add the OAuth client ID and secret.`
              : `Couldn't connect: ${error.replace(/_/g, " ")}`}
          </p>
        )}
        <Card title="Optional: your Google / Microsoft account (Meet & Teams links, captured conversations)">
          <ul className="divide-y divide-gray-100" data-testid="integrations">
            {PROVIDERS.map((p) => {
              const a = accounts.find((x) => x.provider === p);
              return (
                <li key={p} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4" data-testid={`integration-${p.toLowerCase()}`}>
                  <div className="min-w-0 max-w-md">
                    <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {PROVIDER_LABELS[p]} {a ? <Badge tone="green">Connected</Badge> : <Badge>Not connected</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">{WHAT[p]}</p>
                    {a && (
                      <p className="mt-1 text-xs text-gray-600">
                        {a.email} · last email sync {a.lastSyncAt ? formatDateTime(a.lastSyncAt) : "never"}
                        {a.syncError && <span className="block text-red-600">Last sync failed: {a.syncError}</span>}
                      </p>
                    )}
                  </div>
                  <IntegrationActions provider={p} connected={!!a} configured={providerConfigured(p)} />
                </li>
              );
            })}
          </ul>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            Only emails exchanged with contacts of your leads and clients (or their company domain) are copied into the CRM; other mail is never stored.
            Disconnecting removes the CRM&apos;s access; emails already captured stay on the client timeline for continuity.
          </p>
        </Card>

      </PageBody>
    </>
  );
}
