import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactsCard } from "@/components/contacts-card";
import { DetailGrid } from "@/components/detail";
import { DocumentsPanel } from "@/components/documents-panel";
import { EmailsCard } from "@/components/emails-card";
import { MeetingsCard } from "@/components/meetings-card";
import { History } from "@/components/history";
import { InteractionLog } from "@/components/interaction-log";
import { Card, EmptyState, PageBody, PageHeader } from "@/components/layout";
import { MandateList } from "@/components/mandate-list";
import { NewMandateButton } from "@/components/mandate-form";
import { RecordTasks } from "@/components/record-tasks";
import { WhatsAppCard } from "@/components/whatsapp-card";
import { Badge } from "@/components/ui";
import { getCompanyProfile } from "@/lib/company";
import { screenEligibility } from "@/lib/eligibility";
import { formatDate, formatDateTime } from "@/lib/format";
import { interactionInclude, timelineWhere, toTimelineEntry } from "@/lib/interactions";
import { KYC_DOCUMENT_CATEGORIES, KYC_TRANSITIONS, kycDocsEditable } from "@/lib/kyc";
import { ENTITY_TYPE_LABELS, KYC_STATUS_LABELS, KYC_STATUS_TONE, LEAD_SOURCE_LABELS } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { loadRecordComms } from "@/lib/record-comms";
import { can, ownsRecord } from "@/lib/rbac";
import { requirePageUser } from "@/lib/session";
import { advisorOptions, listRms } from "@/lib/users";
import { ClientActions } from "./client-actions";
import { KycPanel } from "./kyc-panel";

const num = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));
const cr = (d: { toString(): string } | null) => (d == null ? "—" : `₹${Number(d.toString()).toLocaleString("en-IN")} Cr`);

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("clients:view");
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      assignedRm: { select: { id: true, name: true } },
      lead: { select: { id: true, createdAt: true } },
      documents: {
        include: { uploadedBy: { select: { name: true } }, mandate: { select: { id: true, code: true } } },
        orderBy: [{ createdAt: "desc" }, { version: "desc" }],
      },
      kycStatusChanges: { include: { changedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      mandates: { include: { leadAdvisor: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!client || !ownsRecord(user, client)) notFound();
  const [rms, advisors, comms, interactions, firm] = await Promise.all([
    listRms(),
    advisorOptions(),
    loadRecordComms(user, { clientId: client.id }),
    prisma.interaction.findMany({
      where: timelineWhere({ clientId: client.id, originLeadId: client.leadId }),
      include: interactionInclude,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    }),
    getCompanyProfile(),
  ]);

  const transitions = KYC_TRANSITIONS.filter((t) => t.from === client.kycStatus && can(user.role, t.permission)).map(({ to, label, requiresNote }) => ({
    to,
    label,
    requiresNote,
  }));
  const eligibility = screenEligibility({
    revenueCr: num(client.revenueCr),
    ebitdaCr: num(client.ebitdaCr),
    netWorthCr: num(client.netWorthCr),
    incorporationYear: client.incorporationYear,
  });
  const canEdit = can(user.role, "clients:edit");

  return (
    <>
      <PageHeader
        title={client.name}
        description={[ENTITY_TYPE_LABELS[client.entityType], client.sector, client.city, `client since ${formatDate(client.createdAt)}`].filter(Boolean).join(" · ")}
        actions={
          canEdit && (
            <ClientActions
              client={{
                id: client.id,
                name: client.name,
                cin: client.cin,
                panNumber: client.panNumber,
                gstin: client.gstin,
                entityType: client.entityType,
                sector: client.sector,
                incorporationYear: client.incorporationYear,
                city: client.city,
                state: client.state,
                website: client.website,
                phone: client.phone,
                email: client.email,
                source: client.source,
                financialYear: client.financialYear,
                revenueCr: num(client.revenueCr),
                ebitdaCr: num(client.ebitdaCr),
                patCr: num(client.patCr),
                netWorthCr: num(client.netWorthCr),
                notes: client.notes,
                assignedRmId: client.assignedRmId,
              }}
              rms={rms}
              canAssign={can(user.role, "clients:assign")}
              panLocked={!kycDocsEditable(client.kycStatus)}
            />
          )
        }
      />
      <PageBody className="space-y-5">
        <Link href="/clients" className="text-xs font-medium text-gray-500 hover:text-gray-900">
          ← All clients
        </Link>
        <div className="grid gap-5 xl:grid-cols-5">
          <div className="space-y-5 xl:col-span-3">
            <Card title="Company">
              <DetailGrid
                items={[
                  { label: "CIN", value: client.cin ? <span className="font-mono text-xs">{client.cin}</span> : <span className="text-amber-700">Not provided</span> },
                  { label: "Company PAN", value: client.panNumber ? <span className="font-mono">{client.panNumber}</span> : <span className="text-amber-700">Not provided</span> },
                  { label: "GSTIN", value: client.gstin ? <span className="font-mono text-xs">{client.gstin}</span> : "—" },
                  { label: "Incorporated", value: client.incorporationYear ?? "—" },
                  { label: "Location", value: [client.city, client.state].filter(Boolean).join(", ") || "—" },
                  {
                    label: "Website",
                    value: client.website ? (
                      <a href={client.website.startsWith("http") ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                        {client.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Source", value: LEAD_SOURCE_LABELS[client.source] },
                  { label: "Assigned RM", value: client.assignedRm?.name ?? "Unassigned" },
                  {
                    label: "Original enquiry",
                    value: client.lead ? (
                      <Link href={`/leads/${client.lead.id}`} className="text-brand-600 hover:underline">
                        View lead ({formatDate(client.lead.createdAt)})
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                ]}
              />
              {client.notes && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <p className="text-xs text-gray-500">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{client.notes}</p>
                </div>
              )}
            </Card>

            <Card title={`Financials${client.financialYear ? ` · ${client.financialYear}` : ""}`}>
              <DetailGrid
                items={[
                  { label: "Revenue", value: cr(client.revenueCr) },
                  { label: "EBITDA", value: cr(client.ebitdaCr) },
                  { label: "PAT", value: cr(client.patCr) },
                  { label: "Net worth", value: cr(client.netWorthCr) },
                ]}
              />
              <div className="border-t border-gray-100 px-5 py-4" data-testid="eligibility">
                <div className="flex items-center gap-2">
                  <Badge tone={eligibility.verdict === "MAINBOARD" ? "green" : eligibility.verdict === "SME" ? "blue" : eligibility.verdict === "PRE_IPO" ? "amber" : "gray"}>
                    {eligibility.label}
                  </Badge>
                </div>
                {eligibility.checks.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-xs text-gray-600 md:grid-cols-2">
                    {eligibility.checks.map((c) => (
                      <li key={c.label}>
                        {c.ok === true ? "✓" : c.ok === false ? "✗" : "?"} {c.label}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-gray-400">
                  Indicative screen from the latest year only. Confirm against current SEBI (ICDR) and NSE Emerge / BSE SME criteria.
                </p>
              </div>
            </Card>

            <Card
              title={`Mandates (${client.mandates.length})`}
              actions={can(user.role, "mandates:manage") && <NewMandateButton clientId={client.id} advisors={advisors} />}
            >
              <MandateList
                mandates={client.mandates.map((m) => ({
                  ...m,
                  expectedFee: num(m.expectedFee),
                  issueSizeCr: num(m.issueSizeCr),
                }))}
              />
            </Card>

            <ContactsCard
              parent={{ clientId: client.id }}
              canEdit={canEdit}
              contacts={client.contacts.map((c) => ({ id: c.id, name: c.name, designation: c.designation, email: c.email, phone: c.phone, isPrimary: c.isPrimary }))}
            />

            <KycPanel
              clientId={client.id}
              status={client.kycStatus}
              categories={[...KYC_DOCUMENT_CATEGORIES]}
              documents={client.documents
                .filter((d) => (KYC_DOCUMENT_CATEGORIES as readonly string[]).includes(d.category))
                .map((d) => ({
                  id: d.id,
                  category: d.category,
                  fileName: d.fileName,
                  sizeBytes: d.sizeBytes,
                  createdAt: d.createdAt.toISOString(),
                  uploadedBy: d.uploadedBy?.name ?? null,
                }))}
              transitions={transitions}
              canUpload={can(user.role, "kyc:upload")}
              docsEditable={kycDocsEditable(client.kycStatus)}
            />
          </div>
          <div className="space-y-5 xl:col-span-2">
            <MeetingsCard
              parent={{ clientId: client.id }}
              meetings={comms.meetings}
              contacts={client.contacts.map((c) => ({ name: c.name, email: c.email, phone: c.phone }))}
              mandates={client.mandates.map((m) => ({ id: m.id, code: m.code, title: m.title }))}
              connected={comms.connected}
              me={comms.me}
              firmName={firm.firmName}
              canSchedule={can(user.role, "meetings:manage")}
            />
            <WhatsAppCard parent={{ clientId: client.id }} contacts={client.contacts.map((c) => ({ name: c.name, phone: c.phone }))} firm={comms.firm.whatsapp} isAdmin={user.role === "ADMIN"} canSend={can(user.role, "interactions:log")} />
            <RecordTasks user={user} target={{ clientId: client.id }} />
            <InteractionLog
              target={{ clientId: client.id }}
              entries={interactions.map((i) => toTimelineEntry(i, can(user.role, "interactions:viewRemoved")))}
              canLog={can(user.role, "interactions:log")}
              canAmend={can(user.role, "interactions:amend")}
            />
            <Card title="KYC audit trail">
              {client.kycStatusChanges.length === 0 ? (
                <EmptyState title="No KYC changes yet" />
              ) : (
                <ol className="space-y-3 px-5 py-4" data-testid="kyc-audit">
                  {client.kycStatusChanges.map((c) => (
                    <li key={c.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.fromStatus && (
                          <>
                            <Badge tone={KYC_STATUS_TONE[c.fromStatus]}>{KYC_STATUS_LABELS[c.fromStatus]}</Badge>
                            <span className="text-gray-400">→</span>
                          </>
                        )}
                        <Badge tone={KYC_STATUS_TONE[c.toStatus]}>{KYC_STATUS_LABELS[c.toStatus]}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {c.changedBy?.name ?? "System"} · {formatDateTime(c.createdAt)}
                      </p>
                      {c.note && <p className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">{c.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <History entities={[{ type: "Client", id: client.id }, ...(client.lead ? [{ type: "Lead", id: client.lead.id }] : [])]} title="Activity (client & lead)" />
          </div>
        </div>
        <EmailsCard
          parent={{ clientId: client.id }}
          emails={comms.emails}
          recipients={client.contacts.filter((c) => c.email).map((c) => ({ name: c.name, email: c.email! }))}
          connected={comms.connected}
          canSend={can(user.role, "emails:send")}
        />
        <DocumentsPanel
          clientId={client.id}
          canUpload={can(user.role, "docs:upload")}
          mandates={client.mandates.map((m) => ({ id: m.id, code: m.code, title: m.title }))}
          documents={client.documents.map((d) => ({
            id: d.id,
            groupId: d.groupId,
            version: d.version,
            isLatest: d.isLatest,
            category: d.category,
            title: d.title,
            fileName: d.fileName,
            sizeBytes: d.sizeBytes,
            notes: d.notes,
            createdAt: d.createdAt.toISOString(),
            uploadedBy: d.uploadedBy?.name ?? null,
            mandate: d.mandate,
          }))}
        />
      </PageBody>
    </>
  );
}
