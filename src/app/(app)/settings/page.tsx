import { Card, PageBody, PageHeader } from "@/components/layout";
import { getCompanyProfile } from "@/lib/company";
import { PROVIDER_LABELS } from "@/lib/integrations/config";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/session";
import { smtpSettings, systemSender } from "@/lib/system-mail";
import { firmWhatsappStatus } from "@/lib/whatsapp-client";
import { WhatsAppLink } from "@/components/whatsapp-link";
import { headers } from "next/headers";
import { CompanyForm } from "./company-form";
import { SystemEmailCard } from "./system-email-card";

export default async function SettingsPage() {
  const me = await requirePageUser("settings:manage");
  const [company, sender, admins, profileRow, wa] = await Promise.all([
    getCompanyProfile(),
    systemSender(),
    prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true, name: true, email: true, connectedAccounts: { select: { provider: true } } }, orderBy: { name: "asc" } }),
    prisma.companyProfile.findUnique({ where: { id: 1 }, select: { systemSenderUserId: true, smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true } }),
    firmWhatsappStatus(),
  ]);
  const smtp = await smtpSettings(profileRow ?? null);
  const h = await headers();
  const base = process.env.NEXTAUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const key = process.env.WEBSITE_API_KEY;
  const origins = process.env.WEBSITE_ALLOWED_ORIGINS ?? "https://beipoready.com,https://www.beipoready.com";
  const example = `fetch("${base}/api/public/leads", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Api-Key": "<WEBSITE_API_KEY>" },
  body: JSON.stringify({
    type: "readiness_call",        // or "readiness_check" | "enquiry"
    companyName: "Acme Industries Pvt Ltd",
    name: "Ravi Kumar", designation: "Promoter",
    email: "ravi@acme.in", phone: "+91 98xxx xxxxx",
    service: "SME_IPO",            // FUND_RAISING | PRE_IPO | SME_IPO | MAINBOARD_IPO | VALUATION_RESTRUCTURING
    revenueCr: 45, city: "Pune", sector: "Chemicals",
    preferredTime: "Tomorrow 11 am", message: "…",
    readiness: { score: 72, answers: { "Years in operation": "5+" } },
  }),
});`;
  return (
    <>
      <PageHeader title="Settings" description="Company profile shown in the CRM header, sidebar and sign-in page" />
      <PageBody className="max-w-3xl space-y-5">
        <Card title="Company profile">
          <CompanyForm company={company} />
        </Card>
        <Card title="Firm email (all users send from this mailbox)">
          <SystemEmailCard
            sender={{ userId: profileRow?.systemSenderUserId ?? null, method: sender.method, fromEmail: sender.fromEmail, summary: sender.summary }}
            admins={admins.map((a) => ({ id: a.id, name: a.name, email: a.email, mailboxes: a.connectedAccounts.map((c) => PROVIDER_LABELS[c.provider].split(" ")[0]) }))}
            smtp={smtp ? { host: smtp.host, port: smtp.port, user: smtp.user, from: smtp.from, secure: smtp.secure, source: smtp.source, hasPassword: !!smtp.pass } : null}
            currentUserId={me.id}
          />
        </Card>
        <Card title="Firm WhatsApp (all users send from this number)">
          <div className="px-5 py-4">
            <WhatsAppLink initial={{ ...wa, qr: null }} canManage />
          </div>
        </Card>
        <Card title="Website integration (beipoready.com forms)">
          <div className="space-y-3 px-5 py-4 text-sm text-gray-700" data-testid="website-integration">
            <p>
              Point the <b>Book an IPO Readiness Call</b>, <b>2-minute IPO-ready check</b> and contact forms at this endpoint. Each submission becomes an
              enquiry assigned to the RM with the fewest open enquiries; repeat submissions from the same email/phone are merged.
            </p>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5">
              <dt className="text-gray-500">Endpoint</dt>
              <dd className="font-mono text-xs">POST {base}/api/public/leads</dd>
              <dt className="text-gray-500">API key</dt>
              <dd>{key ? <span className="text-emerald-700">Configured (ends …{key.slice(-4)})</span> : <span className="text-amber-700">Not set — add WEBSITE_API_KEY to the server environment</span>}</dd>
              <dt className="text-gray-500">Browser origins</dt>
              <dd className="font-mono text-xs">{origins}</dd>
            </dl>
            <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">{example}</pre>
            <p className="text-xs text-gray-500">Prefer calling it from your website&apos;s server so the key isn&apos;t exposed in page source. A hidden &quot;website&quot; field acts as a spam honeypot.</p>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
