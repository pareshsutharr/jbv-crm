"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/layout";
import { Badge, Button } from "@/components/ui";
import { api } from "@/lib/api-client";
import { ProfileForm } from "../account/profile-form";

type Provider = "GOOGLE" | "MICROSOFT";
const PROVIDERS: { id: Provider; label: string; what: string }[] = [
  { id: "GOOGLE", label: "Google (Gmail & Meet)", what: "Google Meet links and calendar invites, and your Gmail conversations with leads and clients." },
  { id: "MICROSOFT", label: "Microsoft (Outlook & Teams)", what: "Teams links and calendar invites, and your Outlook conversations with leads and clients." },
];

type Props = {
  me: { name: string; email: string; designation: string | null; phone: string | null; whatsapp: string | null; meetingLink: string | null; onboardedAt: string | null };
  accounts: { provider: Provider; email: string }[];
  configured: Record<Provider, boolean>;
};

function Step({ n, title, done, optional, children }: { n: number; title: string; done: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <div data-testid={`onboarding-step-${n}`}>
      <Card>
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600")}>
            {done ? <Check size={14} /> : n}
          </span>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <span className="ml-auto">{done ? <Badge tone="green">Done</Badge> : optional ? <Badge>Optional</Badge> : <Badge tone="amber">To do</Badge>}</span>
        </div>
        {children}
      </Card>
    </div>
  );
}

export function OnboardingChecklist({ me, accounts, configured }: Props) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const anyConfigured = configured.GOOGLE || configured.MICROSOFT;

  async function finish() {
    setFinishing(true);
    try {
      await api("/api/account", "PATCH", { onboarded: true });
      router.push("/");
      router.refresh();
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="space-y-5">
      <Step n={1} title="Your details" done={!!me.designation}>
        <ProfileForm id="onboarding-details" initial={me} fields={["name", "designation", "phone", "whatsapp", "meetingLink"]} submitLabel="Save details" />
        <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
          Your name and designation appear in the signature of emails, invitations and WhatsApp messages you send. Those go out from the firm&apos;s shared mailbox and WhatsApp, so there is nothing to connect.
        </p>
      </Step>

      {anyConfigured && (
        <Step n={2} title="Optional: connect Google or Microsoft" done={accounts.length > 0} optional>
          <ul className="divide-y divide-gray-100">
            {PROVIDERS.map((p) => {
              const a = accounts.find((x) => x.provider === p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" data-testid={`onboarding-${p.id.toLowerCase()}`}>
                  <div className="min-w-0 max-w-md">
                    <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {p.label} {a && <Badge tone="green">Connected</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">{p.what}</p>
                    {a && <p className="mt-1 text-xs text-gray-600">{a.email}</p>}
                  </div>
                  {a ? null : configured[p.id] ? (
                    <a href={`/api/integrations/${p.id.toLowerCase()}/connect?return=onboarding`} className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
                      Connect
                    </a>
                  ) : (
                    <span className="max-w-[12rem] text-right text-xs text-gray-400">Not set up on this server yet</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">Only for Google Meet / Teams links and capturing your conversations. Only emails with leads and clients are ever captured.</p>
        </Step>
      )}

      <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 px-5 py-4">
        <p className="text-sm text-gray-600">You can change any of this later under <b>My account</b>.</p>
        <Button onClick={finish} loading={finishing} data-testid="finish-onboarding">
          {me.onboardedAt ? "Back to dashboard" : "Finish setup"}
        </Button>
      </div>
    </div>
  );
}
