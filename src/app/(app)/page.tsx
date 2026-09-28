import Link from "next/link";
import { HBarChart } from "@/components/charts";
import { Card, EmptyState, PageBody, PageHeader } from "@/components/layout";
import { StageProgress } from "@/components/mandate-list";
import { MeetingList } from "@/components/meetings-card";
import { StatTile } from "@/components/stat";
import { Badge } from "@/components/ui";
import { getCompanyProfile } from "@/lib/company";
import { getDashboard } from "@/lib/dashboard";
import { formatDate, formatINRCompact } from "@/lib/format";
import { KYC_STATUS_TONE, LEAD_STATUS_LABELS, LEAD_STATUS_TONE, MANDATE_STAGE_LABELS, mandateStageTone, ROLE_LABELS, SERVICE_SHORT_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac";
import { requirePageUser } from "@/lib/session";
import { firmWhatsappLinked } from "@/lib/whatsapp-client";

export default async function DashboardPage() {
  const user = await requirePageUser();
  const org = can(user.role, "dashboard:org");
  const [d, firm, linked] = await Promise.all([getDashboard(user), getCompanyProfile(), firmWhatsappLinked()]);
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  return (
    <>
      <PageHeader
        title={org ? "Dashboard" : "My dashboard"}
        description={org ? `Firm-wide overview · ${ROLE_LABELS[user.role]}` : "Your enquiries, clients and mandates"}
      />
      <PageBody className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label={org ? "Open enquiries" : "My open enquiries"} value={d.openLeads} hint={`${d.totalLeads} total · ${pct(d.conversionRate)} converted`} href="/leads" />
          <StatTile label={org ? "Client companies" : "My clients"} value={d.totalClients} hint={`${d.kycPending} with KYC pending`} href="/clients" />
          <StatTile label="Active mandates" value={d.activeMandates} hint={`${formatINRCompact(d.pipelineFee)} expected fees`} href="/mandates" />
          <StatTile label="Won this financial year" value={d.wonThisFy} hint={`${formatINRCompact(d.wonFeeThisFy)} in fees`} href="/mandates?status=won" />
        </div>

        <Card title="Mandate pipeline" actions={<Link href="/mandates" className="text-xs font-medium text-brand-600 hover:underline">Open board →</Link>}>
          <div className="grid grid-cols-2 gap-px bg-gray-100 md:grid-cols-3 xl:grid-cols-6" data-testid="pipeline-summary">
            {d.stageColumns.map((c) => (
              <div key={c.key} className="bg-white px-4 py-3">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">{c.count}</p>
                <p className="text-xs tabular-nums text-gray-500">{c.fee ? formatINRCompact(c.fee) : "—"}</p>
              </div>
            ))}
          </div>
        </Card>

        {can(user.role, "meetings:manage") && (
          <Card title="My upcoming meetings" actions={<Link href="/meetings" className="text-xs font-medium text-brand-600 hover:underline">All meetings →</Link>}>
            <MeetingList meetings={d.myMeetings} showRelated firmName={firm.firmName} whatsappLinked={linked} />
          </Card>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Upcoming target dates">
            {d.upcoming.length === 0 ? (
              <EmptyState title="No active mandates with a target date" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {d.upcoming.map((m) => (
                  <li key={m.id}>
                    <Link href={`/mandates/${m.id}`} className="block px-5 py-2.5 hover:bg-gray-50">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-gray-900">{m.client.name}</span>{" "}
                          <span className="text-gray-500">· {SERVICE_SHORT_LABELS[m.service]}</span>
                        </span>
                        <span className="shrink-0 text-xs text-gray-500">{formatDate(m.targetDate)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <Badge tone={mandateStageTone(m.stage)}>{MANDATE_STAGE_LABELS[m.stage]}</Badge>
                        <div className="flex-1">
                          <StageProgress service={m.service} stage={m.stage} />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Enquiries by service">
            <div className="px-4 py-3">
              {d.leadsByService.length ? <HBarChart data={d.leadsByService} ariaLabel="Enquiries by service" /> : <EmptyState title="No enquiries yet" />}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Enquiries by source">
            <div className="px-4 py-3">
              <HBarChart data={d.leadsBySource} ariaLabel="Enquiries by source" />
            </div>
          </Card>
          {org ? (
            <Card title="Enquiries by RM">
              <div className="px-4 py-3">
                {d.leadsByRm.length ? <HBarChart data={d.leadsByRm} ariaLabel="Enquiries by relationship manager" /> : <EmptyState title="No enquiries yet" />}
              </div>
            </Card>
          ) : (
            <Card title="My enquiries by status">
              <div className="px-4 py-3">
                <HBarChart data={d.leadsByStatus} ariaLabel="My enquiries by status" />
              </div>
            </Card>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Onboarding KYC">
            <ul className="divide-y divide-gray-100">
              {d.kyc.map((k) => (
                <li key={k.status}>
                  <Link href={`/clients?kyc=${k.status}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-gray-50">
                    <Badge tone={KYC_STATUS_TONE[k.status]}>{k.label}</Badge>
                    <span className="font-medium tabular-nums text-gray-900">{k.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={org ? "Latest open enquiries" : "My latest enquiries"} className="lg:col-span-2">
            {d.recentLeads.length === 0 ? (
              <EmptyState title="No open enquiries" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {d.recentLeads.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm hover:bg-gray-50">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{l.companyName}</p>
                        <p className="text-xs text-gray-500">
                          {l.name} · {l.serviceInterest ? SERVICE_SHORT_LABELS[l.serviceInterest] : "Service TBD"} · {l.assignedRm?.name ?? "Unassigned"} · {formatDate(l.createdAt)}
                        </p>
                      </div>
                      <Badge tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  );
}
