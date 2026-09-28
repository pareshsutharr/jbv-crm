/* eslint-disable no-console */
/**
 * Demo data for the Be IPO Ready CRM: company enquiries, client companies,
 * mandates across the IPO / fund-raising / valuation pipelines, IPO issues,
 * documents, interactions, tasks and notifications.
 *
 * `npm run db:seed` wipes the database (and ./uploads/clients) and reloads it.
 */
import {
  PrismaClient,
  type DocumentCategory,
  type EntityType,
  type KycStatus,
  type LeadSource,
  type LeadStatus,
  type MandateStage,
  type Role,
  type ServiceLine,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PIPELINES, estimateFee, defaultBoard } from "../src/lib/mandates";
import { endOfZonedDay } from "../src/lib/tz";

const prisma = new PrismaClient();
const PASSWORD = "Password@123";
const ADMIN_EMAIL = "admin@beipoready.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "beipoready@123456";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

/** A tiny one-page PDF so seeded documents can be opened. */
function samplePdf(text: string) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
/** A calendar date (UTC midnight) `offset` days from today, for DATE columns. */
const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

const KYC_DOCS: [DocumentCategory, string, string][] = [
  ["KYC_COI", "certificate-of-incorporation.pdf", "Certificate of Incorporation"],
  ["KYC_PAN", "company-pan.pdf", "Company PAN"],
  ["KYC_GST", "gst-certificate.pdf", "GST Certificate"],
  ["KYC_MOA_AOA", "moa-aoa.pdf", "MOA and AOA"],
  ["KYC_BOARD_RESOLUTION", "board-resolution.pdf", "Board Resolution"],
  ["KYC_PROMOTER_KYC", "promoter-kyc.pdf", "Promoter KYC"],
];

async function writeDoc(opts: {
  clientId: string;
  category: DocumentCategory;
  title?: string;
  versions: { fileName: string; age: number; by: string }[];
  mandateId?: string;
}) {
  const groupId = randomUUID();
  await mkdir(path.join(UPLOAD_DIR, "clients", opts.clientId), { recursive: true });
  for (const [i, v] of opts.versions.entries()) {
    const storageKey = `clients/${opts.clientId}/${randomUUID()}.pdf`;
    const data = samplePdf(`${opts.title ?? v.fileName} v${i + 1} (sample)`);
    await writeFile(path.join(UPLOAD_DIR, storageKey), data);
    await prisma.document.create({
      data: {
        id: i === 0 ? groupId : randomUUID(),
        groupId,
        version: i + 1,
        isLatest: i === opts.versions.length - 1,
        clientId: opts.clientId,
        mandateId: opts.mandateId,
        category: opts.category,
        title: opts.title,
        fileName: v.fileName,
        storageKey,
        mimeType: "application/pdf",
        sizeBytes: data.length,
        uploadedById: v.by,
        createdAt: daysAgo(v.age),
      },
    });
  }
}

async function main() {
  console.log("Resetting data…");
  // Interactions are protected by a no-delete trigger; TRUNCATE is the reset path.
  await prisma.$executeRawUnsafe('TRUNCATE "InteractionRevision", "Interaction"');
  await prisma.auditLog.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.task.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mandateStageChange.deleteMany();
  await prisma.document.deleteMany();
  await prisma.mandate.deleteMany();
  await prisma.ipo.deleteMany();
  await prisma.kycStatusChange.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.client.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.user.deleteMany();
  await rm(path.join(UPLOAD_DIR, "clients"), { recursive: true, force: true });

  // ─── Users ─────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const seededAt = new Date();
  const mkUser = (name: string, email: string, role: Role, active = true, extra: { designation?: string; passwordHash?: string } = {}) =>
    prisma.user.create({ data: { name, email, role, active, passwordHash: extra.passwordHash ?? passwordHash, designation: extra.designation ?? null, onboardedAt: seededAt } });
  // The administrator account doubles as the system mailbox (invitations are sent from it once it's connected under My account).
  const admin = await mkUser("Rakesh Doshi", ADMIN_EMAIL, "ADMIN", true, { designation: "CEO", passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) });
  const compliance = await mkUser("Vikram Rao", "compliance@beipoready.com", "COMPLIANCE", true, { designation: "Compliance Officer" });
  const rm1 = await mkUser("Rohan Sharma", "rohan@beipoready.com", "RM", true, { designation: "Relationship Manager" });
  const rm2 = await mkUser("Priya Nair", "priya@beipoready.com", "RM", true, { designation: "Relationship Manager" });
  await mkUser("Kabir Singh", "viewer@beipoready.com", "VIEWER");
  await mkUser("Neha Gupta", "neha@beipoready.com", "VIEWER", false); // pending self-signup
  const rmOf = { rm1, rm2 };

  // ─── Open enquiries (leads) ────────────────────────────────────────────
  type LeadSeed = {
    company: string; contact: string; designation: string; phone: string; email?: string; city: string; sector: string;
    service: ServiceLine | null; revenue: number | null; source: LeadSource; status: LeadStatus; rm: "rm1" | "rm2" | null; age: number;
    readiness?: { score: number; answers: Record<string, string> };
  };
  const openLeads: LeadSeed[] = [
    { company: "Vardhaman Polymers Pvt Ltd", contact: "Ankit Verma", designation: "Managing Director", phone: "+91 98200 11223", email: "ankit@vardhamanpolymers.in", city: "Ahmedabad", sector: "Plastics & packaging", service: "SME_IPO", revenue: 68, source: "READINESS_CALL", status: "NEW", rm: "rm1", age: 1 },
    {
      company: "Kulkarni Agritech Pvt Ltd", contact: "Sneha Kulkarni", designation: "Founder & CEO", phone: "+91 98111 45678", email: "sneha@kulkarniagritech.com", city: "Pune", sector: "Agritech", service: "PRE_IPO", revenue: 24, source: "READINESS_CHECK", status: "CONTACTED", rm: "rm1", age: 4,
      readiness: {
        score: 62,
        answers: {
          "Years in operation": "5–7 years",
          "Latest annual revenue": "₹10–50 Cr",
          "EBITDA positive in last 2 years": "Yes",
          "Audited financials (3 years)": "Yes",
          "Corporate structure": "Private limited",
          "Target timeline": "12–18 months",
        },
      },
    },
    { company: "Iyer Precision Castings Ltd", contact: "Rajesh Iyer", designation: "Director – Finance", phone: "+91 99870 33445", city: "Coimbatore", sector: "Auto components", service: "MAINBOARD_IPO", revenue: 310, source: "REFERRAL", status: "DISCOVERY", rm: "rm2", age: 7 },
    { company: "Joshi Home Décor LLP", contact: "Meera Joshi", designation: "Partner", phone: "+91 90040 99881", email: "meera@joshidecor.in", city: "Jaipur", sector: "Home furnishings", service: "FUND_RAISING", revenue: 9, source: "WEBSITE", status: "LOST", rm: "rm2", age: 20 },
    { company: "Qureshi Cold Chain Pvt Ltd", contact: "Farhan Qureshi", designation: "Promoter", phone: "+91 97690 12121", email: "farhan@qcoldchain.in", city: "Mumbai", sector: "Logistics", service: null, revenue: null, source: "READINESS_CALL", status: "NEW", rm: null, age: 0 },
    { company: "Menon Healthcare Services Pvt Ltd", contact: "Divya Menon", designation: "CFO", phone: "+91 98450 67676", email: "divya@menonhealth.in", city: "Kochi", sector: "Healthcare", service: "VALUATION_RESTRUCTURING", revenue: 55, source: "EVENT", status: "QUALIFIED", rm: "rm2", age: 3 },
  ];
  for (const l of openLeads) {
    await prisma.lead.create({
      data: {
        companyName: l.company, name: l.contact, designation: l.designation, phone: l.phone, email: l.email, city: l.city, sector: l.sector,
        serviceInterest: l.service, revenueCr: l.revenue, source: l.source, status: l.status, assignedRmId: l.rm ? rmOf[l.rm].id : null,
        createdById: admin.id, createdAt: daysAgo(l.age), readinessScore: l.readiness?.score, readinessAnswers: l.readiness?.answers,
      },
    });
  }

  // ─── Client companies (converted from enquiries) ───────────────────────
  type ClientSeed = {
    name: string; entity: EntityType; cin: string; pan: string; gstin: string; sector: string; year: number; city: string; state: string; website: string;
    contacts: { name: string; designation: string; email: string; phone: string }[];
    fy: string; revenue: number; ebitda: number; pat: number; netWorth: number;
    source: LeadSource; kyc: KycStatus; rm: "rm1" | "rm2"; age: number; service: ServiceLine;
  };
  const clientSeeds: ClientSeed[] = [
    {
      name: "Sahyadri Renewables Pvt Ltd", entity: "PRIVATE_LIMITED", cin: "U40100MH2016PTC281234", pan: "AAKCS4821M", gstin: "27AAKCS4821M1Z5", sector: "Renewable energy (solar EPC)", year: 2016, city: "Pune", state: "Maharashtra", website: "sahyadrirenewables.in",
      contacts: [
        { name: "Suresh Patil", designation: "Promoter & MD", email: "suresh@sahyadrirenewables.in", phone: "+91 98250 55001" },
        { name: "Anita Deshpande", designation: "CFO", email: "anita.d@sahyadrirenewables.in", phone: "+91 98250 55011" },
        { name: "Kiran Joshi", designation: "Company Secretary", email: "cs@sahyadrirenewables.in", phone: "+91 98250 55012" },
      ],
      fy: "FY2025-26", revenue: 142, ebitda: 18.5, pat: 9.8, netWorth: 46, source: "REFERRAL", kyc: "VERIFIED", rm: "rm1", age: 210, service: "SME_IPO",
    },
    {
      name: "Kaveri Agro Foods Ltd", entity: "PUBLIC_LIMITED", cin: "U15400KA2009PLC050321", pan: "AADCK7310Q", gstin: "29AADCK7310Q1ZP", sector: "Food processing", year: 2009, city: "Mysuru", state: "Karnataka", website: "kaveriagro.com",
      contacts: [
        { name: "Arjun Kapoor", designation: "Chairman & MD", email: "arjun@kaveriagro.com", phone: "+91 98330 44556" },
        { name: "Latha Rao", designation: "CFO", email: "latha.rao@kaveriagro.com", phone: "+91 98330 44557" },
      ],
      fy: "FY2025-26", revenue: 620, ebitda: 74, pat: 38, netWorth: 290, source: "WEBSITE", kyc: "VERIFIED", rm: "rm2", age: 120, service: "MAINBOARD_IPO",
    },
    {
      name: "Nimbus Tech Pvt Ltd", entity: "PRIVATE_LIMITED", cin: "U72200MH2018PTC309876", pan: "AAGCN9012M", gstin: "27AAGCN9012M1ZQ", sector: "SaaS / B2B software", year: 2018, city: "Mumbai", state: "Maharashtra", website: "nimbustech.in",
      contacts: [{ name: "Karan Mehta", designation: "Co-founder & CEO", email: "karan@nimbustech.in", phone: "+91 22 4000 1234" }],
      fy: "FY2025-26", revenue: 38, ebitda: 2.4, pat: 0.9, netWorth: 21, source: "READINESS_CHECK", kyc: "UNDER_REVIEW", rm: "rm2", age: 45, service: "PRE_IPO",
    },
    {
      name: "Patel Precision Engineering Pvt Ltd", entity: "PRIVATE_LIMITED", cin: "U29100GJ2011PTC065432", pan: "AAECP5678L", gstin: "24AAECP5678L1ZD", sector: "Engineering / capital goods", year: 2011, city: "Rajkot", state: "Gujarat", website: "patelprecision.co.in",
      contacts: [{ name: "Hitesh Patel", designation: "Managing Director", email: "hitesh@patelprecision.co.in", phone: "+91 98250 55002" }],
      fy: "FY2025-26", revenue: 88, ebitda: 11, pat: 5.2, netWorth: 34, source: "REFERRAL", kyc: "SUBMITTED", rm: "rm1", age: 60, service: "FUND_RAISING",
    },
    {
      name: "Reddy Pharma Formulations Pvt Ltd", entity: "PRIVATE_LIMITED", cin: "U24230TG2014PTC093456", pan: "AAFCR3456N", gstin: "36AAFCR3456N1ZX", sector: "Pharmaceuticals", year: 2014, city: "Hyderabad", state: "Telangana", website: "reddypharmaform.com",
      contacts: [{ name: "Kavita Reddy", designation: "Director", email: "kavita@reddypharmaform.com", phone: "+91 99000 22110" }],
      fy: "FY2025-26", revenue: 47, ebitda: 6.1, pat: 3.3, netWorth: 19, source: "CALL_IN", kyc: "PENDING", rm: "rm2", age: 12, service: "VALUATION_RESTRUCTURING",
    },
    {
      name: "Nilgiri Foods Ltd", entity: "PUBLIC_LIMITED", cin: "U15490TN2012PLC087654", pan: "AAHCN4321P", gstin: "33AAHCN4321P1ZK", sector: "Packaged foods", year: 2012, city: "Coimbatore", state: "Tamil Nadu", website: "nilgirifoods.in",
      contacts: [{ name: "Deepak Sinha", designation: "Whole-time Director", email: "deepak@nilgirifoods.in", phone: "+91 98430 11220" }],
      fy: "FY2025-26", revenue: 96, ebitda: 13.2, pat: 7.1, netWorth: 41, source: "EVENT", kyc: "VERIFIED", rm: "rm1", age: 330, service: "SME_IPO",
    },
  ];
  const kycPath: Record<KycStatus, KycStatus[]> = {
    PENDING: [],
    SUBMITTED: ["SUBMITTED"],
    UNDER_REVIEW: ["SUBMITTED", "UNDER_REVIEW"],
    VERIFIED: ["SUBMITTED", "UNDER_REVIEW", "VERIFIED"],
    REJECTED: ["SUBMITTED", "UNDER_REVIEW", "REJECTED"],
  };
  const clients: Record<string, { id: string; leadId: string; rmId: string }> = {};
  for (const c of clientSeeds) {
    const rmId = rmOf[c.rm].id;
    const primary = c.contacts[0];
    const lead = await prisma.lead.create({
      data: {
        companyName: c.name, name: primary.name, designation: primary.designation, phone: primary.phone, email: primary.email, city: c.city, sector: c.sector,
        serviceInterest: c.service, revenueCr: c.revenue, source: c.source, status: "CONVERTED", assignedRmId: rmId, createdById: admin.id,
        createdAt: daysAgo(c.age + 14), convertedAt: daysAgo(c.age),
      },
    });
    const client = await prisma.client.create({
      data: {
        name: c.name, entityType: c.entity, cin: c.cin, panNumber: c.pan, gstin: c.gstin, sector: c.sector, incorporationYear: c.year, city: c.city, state: c.state, website: c.website,
        source: c.source, financialYear: c.fy, revenueCr: c.revenue, ebitdaCr: c.ebitda, patCr: c.pat, netWorthCr: c.netWorth,
        kycStatus: c.kyc, assignedRmId: rmId, leadId: lead.id, createdAt: daysAgo(c.age),
        contacts: { create: c.contacts.map((p, i) => ({ ...p, isPrimary: i === 0 })) },
      },
    });
    clients[c.name] = { id: client.id, leadId: lead.id, rmId };
    await prisma.kycStatusChange.create({ data: { clientId: client.id, fromStatus: null, toStatus: "PENDING", changedById: rmId, note: "Client onboarded from enquiry", createdAt: daysAgo(c.age) } });
    if (c.kyc !== "PENDING") {
      for (const [category, fileName, title] of KYC_DOCS) {
        await writeDoc({ clientId: client.id, category, title: `${title} – ${c.name}`, versions: [{ fileName, age: c.age - 1, by: rmId }] });
      }
    }
    let from: KycStatus = "PENDING";
    for (const [i, to] of kycPath[c.kyc].entries()) {
      await prisma.kycStatusChange.create({
        data: {
          clientId: client.id, fromStatus: from, toStatus: to, changedById: to === "SUBMITTED" ? rmId : compliance.id,
          note: to === "VERIFIED" ? "Incorporation documents and promoter KYC verified" : null, createdAt: daysAgo(c.age - 2 - i),
        },
      });
      from = to;
    }
    await prisma.auditLog.create({ data: { entityType: "Lead", entityId: lead.id, action: "converted", userId: rmId, metadata: { clientId: client.id }, createdAt: daysAgo(c.age) } });
  }

  // ─── IPO issues ────────────────────────────────────────────────────────
  const sahyadriIpo = await prisma.ipo.create({
    data: {
      companyName: "Sahyadri Renewables Ltd", symbol: "SAHYADRI", exchange: "NSE Emerge", priceBandLow: 142, priceBandHigh: 150, lotSize: 1000,
      openDate: day(-1), closeDate: day(2), listingDate: day(5), status: "OPEN", notes: "Fresh issue ₹42 Cr. Anchor book fully subscribed.", createdById: admin.id,
    },
  });
  const nilgiriIpo = await prisma.ipo.create({
    data: {
      companyName: "Nilgiri Foods Ltd", symbol: "NILGIRI", exchange: "NSE Emerge", priceBandLow: 96, priceBandHigh: 101, lotSize: 1200,
      openDate: day(-40), closeDate: day(-37), listingDate: day(-32), status: "LISTED", notes: "Listed at 22% premium.", createdById: admin.id,
    },
  });
  await prisma.ipo.create({
    data: {
      companyName: "Kaveri Fintech Ltd", symbol: "KAVERIFIN", exchange: "NSE, BSE", priceBandLow: 142, priceBandHigh: 150, lotSize: 100,
      openDate: day(6), closeDate: day(8), listingDate: day(13), status: "UPCOMING", notes: "Market tracker — not our mandate. Comparable NBFC issue.", createdById: admin.id,
    },
  });

  // ─── Mandates ──────────────────────────────────────────────────────────
  type MandateSeed = {
    client: string; title: string; service: ServiceLine; stage: MandateStage; sizeCr: number | null; retainer: number | null; pct: number | null;
    target: number | null; advisor: "rm1" | "rm2"; startedDaysAgo: number; ipoId?: string; note?: string; pausedFrom?: MandateStage;
  };
  const mandateSeeds: MandateSeed[] = [
    { client: "Sahyadri Renewables Pvt Ltd", title: "SME IPO on NSE Emerge", service: "SME_IPO", stage: "ISSUE_OPEN", sizeCr: 42, retainer: 1500000, pct: 3.5, target: 5, advisor: "rm1", startedDaysAgo: 200, ipoId: sahyadriIpo.id },
    { client: "Kaveri Agro Foods Ltd", title: "Main board IPO (fresh issue + OFS)", service: "MAINBOARD_IPO", stage: "DRHP_DRAFTING", sizeCr: 250, retainer: 5000000, pct: 2, target: 240, advisor: "rm2", startedDaysAgo: 110 },
    { client: "Nimbus Tech Pvt Ltd", title: "Pre-IPO round & IPO readiness", service: "PRE_IPO", stage: "INVESTOR_OUTREACH", sizeCr: 25, retainer: 800000, pct: 2.5, target: 90, advisor: "rm2", startedDaysAgo: 40 },
    { client: "Patel Precision Engineering Pvt Ltd", title: "Growth capital – ₹18 Cr private placement", service: "FUND_RAISING", stage: "TERM_SHEET", sizeCr: 18, retainer: 500000, pct: 3, target: 30, advisor: "rm1", startedDaysAgo: 55 },
    { client: "Reddy Pharma Formulations Pvt Ltd", title: "Valuation for share swap & restructuring", service: "VALUATION_RESTRUCTURING", stage: "PROPOSAL", sizeCr: null, retainer: 450000, pct: null, target: 21, advisor: "rm2", startedDaysAgo: 8 },
    { client: "Nilgiri Foods Ltd", title: "SME IPO on NSE Emerge", service: "SME_IPO", stage: "LISTED", sizeCr: 28, retainer: 1200000, pct: 3.5, target: -32, advisor: "rm1", startedDaysAgo: 320, ipoId: nilgiriIpo.id },
    { client: "Sahyadri Renewables Pvt Ltd", title: "Valuation of solar SPV (for IPO restructuring)", service: "VALUATION_RESTRUCTURING", stage: "COMPLETED", sizeCr: null, retainer: 350000, pct: null, target: -150, advisor: "rm1", startedDaysAgo: 190 },
    { client: "Patel Precision Engineering Pvt Ltd", title: "SME IPO (after growth round)", service: "SME_IPO", stage: "ON_HOLD", sizeCr: 35, retainer: 1200000, pct: 3.5, target: 300, advisor: "rm1", startedDaysAgo: 50, pausedFrom: "MANDATE_SIGNED", note: "Promoter wants to close the private round first" },
  ];
  let seq = 1;
  const year = new Date().getFullYear();
  const mandates: Record<string, string> = {};
  for (const ms of mandateSeeds) {
    const c = clients[ms.client];
    const pipeline = PIPELINES[ms.service];
    const path_ = ms.stage === "ON_HOLD" || ms.stage === "DROPPED" ? [...pipeline.slice(0, pipeline.indexOf(ms.pausedFrom!) + 1), ms.stage] : pipeline.slice(0, pipeline.indexOf(ms.stage) + 1);
    // Spread the stage changes evenly between the start date and a few days ago.
    const stepDays = path_.length > 1 ? Math.max(1, Math.floor((ms.startedDaysAgo - 2) / (path_.length - 1))) : 0;
    const when = (i: number) => daysAgo(ms.startedDaysAgo - i * stepDays);
    const signedIdx = path_.indexOf("MANDATE_SIGNED");
    const closed = ms.stage === "LISTED" || ms.stage === "COMPLETED" || ms.stage === "DROPPED";
    const m = await prisma.mandate.create({
      data: {
        code: `BIR-${year}-${String(seq++).padStart(3, "0")}`,
        title: ms.title, clientId: c.id, service: ms.service, board: defaultBoard(ms.service), stage: ms.stage, stageChangedAt: when(path_.length - 1),
        issueSizeCr: ms.sizeCr, retainerFee: ms.retainer, successFeePct: ms.pct, expectedFee: estimateFee(ms.sizeCr, ms.retainer, ms.pct),
        targetDate: ms.target == null ? null : day(ms.target), signedAt: signedIdx >= 0 ? when(signedIdx) : null, closedAt: closed ? when(path_.length - 1) : null,
        leadAdvisorId: rmOf[ms.advisor].id, ipoId: ms.ipoId, createdById: rmOf[ms.advisor].id, createdAt: when(0),
      },
    });
    mandates[`${ms.client}|${ms.service}`] = m.id;
    for (const [i, stage] of path_.entries()) {
      await prisma.mandateStageChange.create({
        data: {
          mandateId: m.id, fromStage: i === 0 ? null : path_[i - 1], toStage: stage, changedById: rmOf[ms.advisor].id, createdAt: when(i),
          note: i === 0 ? "Mandate opened" : stage === "MANDATE_SIGNED" ? "Engagement letter signed" : stage === ms.stage && ms.note ? ms.note : null,
        },
      });
    }
    await prisma.auditLog.create({ data: { entityType: "Client", entityId: c.id, action: "mandate_created", userId: rmOf[ms.advisor].id, metadata: { mandateId: m.id, code: m.code, title: m.title }, createdAt: when(0) } });
  }

  // ─── Engagement documents ──────────────────────────────────────────────
  const sahyadri = clients["Sahyadri Renewables Pvt Ltd"];
  const sahyadriIpoMandate = mandates["Sahyadri Renewables Pvt Ltd|SME_IPO"];
  await writeDoc({ clientId: sahyadri.id, category: "ENGAGEMENT_LETTER", title: "IPO mandate letter (signed)", mandateId: sahyadriIpoMandate, versions: [{ fileName: "mandate-letter-signed.pdf", age: 190, by: rm1.id }] });
  await writeDoc({ clientId: sahyadri.id, category: "FINANCIALS", title: "Audited financials FY24–FY26", mandateId: sahyadriIpoMandate, versions: [{ fileName: "audited-financials-3y.pdf", age: 170, by: rm1.id }] });
  await writeDoc({
    clientId: sahyadri.id, category: "DRHP", title: "Draft Red Herring Prospectus", mandateId: sahyadriIpoMandate,
    versions: [
      { fileName: "drhp-draft-v1.pdf", age: 120, by: rm1.id },
      { fileName: "drhp-filed.pdf", age: 100, by: admin.id },
    ],
  });
  await writeDoc({ clientId: clients["Kaveri Agro Foods Ltd"].id, category: "NDA", title: "Mutual NDA", versions: [{ fileName: "nda-kaveri.pdf", age: 118, by: rm2.id }] });
  await writeDoc({ clientId: clients["Kaveri Agro Foods Ltd"].id, category: "ENGAGEMENT_LETTER", title: "Mainboard IPO mandate", mandateId: mandates["Kaveri Agro Foods Ltd|MAINBOARD_IPO"], versions: [{ fileName: "kaveri-mandate.pdf", age: 100, by: rm2.id }] });
  await writeDoc({ clientId: clients["Nimbus Tech Pvt Ltd"].id, category: "PITCH_DECK", title: "Investor deck", mandateId: mandates["Nimbus Tech Pvt Ltd|PRE_IPO"], versions: [{ fileName: "nimbus-deck.pdf", age: 20, by: rm2.id }] });

  // ─── Historical enquiries (for reports) ────────────────────────────────
  const history: [string, string, LeadSource, ServiceLine, number, "LOST" | "CONTACTED", "rm1" | "rm2"][] = [
    ["Chandra Textiles Pvt Ltd", "Harish Chandra", "REFERRAL", "SME_IPO", 160, "LOST", "rm1"],
    ["Iyer Spices Exports", "Lakshmi Iyer", "WEBSITE", "FUND_RAISING", 150, "LOST", "rm2"],
    ["Malhotra Auto Parts Pvt Ltd", "Gaurav Malhotra", "CALL_IN", "SME_IPO", 140, "CONTACTED", "rm1"],
    ["Deshmukh Dairy Pvt Ltd", "Pooja Deshmukh", "READINESS_CHECK", "PRE_IPO", 125, "LOST", "rm2"],
    ["Sheikh Leather Works", "Imran Sheikh", "WEBSITE", "FUND_RAISING", 118, "LOST", "rm1"],
    ["Bansal Steel Tubes Pvt Ltd", "Ritu Bansal", "READINESS_CALL", "SME_IPO", 100, "CONTACTED", "rm1"],
    ["Rathi Chemicals Pvt Ltd", "Sanjay Rathi", "OTHER", "VALUATION_RESTRUCTURING", 92, "LOST", "rm2"],
    ["Pillai Marine Foods Pvt Ltd", "Anjali Pillai", "REFERRAL", "SME_IPO", 85, "CONTACTED", "rm2"],
    ["Krishnan EduTech Pvt Ltd", "Mohan Krishnan", "WEBSITE", "PRE_IPO", 64, "LOST", "rm2"],
    ["Shah Ceramics Pvt Ltd", "Tanvi Shah", "READINESS_CALL", "SME_IPO", 55, "CONTACTED", "rm1"],
  ];
  for (const [i, [company, contact, source, service, age, status, who]] of history.entries()) {
    const digits = `98${String(20000000 + i * 137911)}`;
    await prisma.lead.create({
      data: {
        companyName: company, name: contact, phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, source, serviceInterest: service, status,
        assignedRmId: rmOf[who].id, createdById: admin.id, createdAt: daysAgo(age),
      },
    });
  }

  // ─── Interaction log ───────────────────────────────────────────────────
  const leadByCompany = (name: string) => prisma.lead.findFirstOrThrow({ where: { companyName: name } });
  const kulkarni = await leadByCompany("Kulkarni Agritech Pvt Ltd");
  const iyer = await leadByCompany("Iyer Precision Castings Ltd");
  const vardhaman = await leadByCompany("Vardhaman Polymers Pvt Ltd");
  await prisma.interaction.createMany({
    data: [
      { leadId: kulkarni.id, type: "CALL", occurredAt: hoursAgo(80), summary: "Intro call after the website IPO-ready check. Wants to understand pre-IPO round vs direct SME IPO.", loggedById: rm1.id },
      { leadId: kulkarni.id, type: "EMAIL", occurredAt: hoursAgo(60), summary: "Sent readiness checklist and our pre-IPO advisory note.", loggedById: rm1.id },
      { leadId: iyer.id, type: "MEETING", occurredAt: hoursAgo(30), summary: "Discovery meeting at Coimbatore plant. Revenue ~₹310 Cr; exploring main board in FY27. Shared data-room list.", loggedById: rm2.id },
      { leadId: sahyadri.leadId, type: "CALL", occurredAt: daysAgo(222), summary: "Referral from a CA partner. Discussed SME IPO route and indicative timelines.", loggedById: rm1.id },
      { clientId: sahyadri.id, type: "MEETING", occurredAt: daysAgo(3), summary: "Pre-issue review with promoter and CFO: anchor allocation done, marketing plan for retail.", loggedById: rm1.id },
      { clientId: sahyadri.id, type: "WHATSAPP", occurredAt: hoursAgo(5), summary: "Day 1 subscription update shared with promoter: 2.4x overall.", loggedById: rm1.id },
      { clientId: clients["Kaveri Agro Foods Ltd"].id, type: "EMAIL", occurredAt: hoursAgo(26), summary: "Shared DRHP chapter drafts (business, risk factors) for CFO review.", loggedById: rm2.id },
      { clientId: clients["Patel Precision Engineering Pvt Ltd"].id, type: "CALL", occurredAt: hoursAgo(50), summary: "Term sheet received from family office; negotiating board seat and liquidation preference.", loggedById: rm1.id },
    ],
  });
  // An entry corrected by an admin, with its revision preserved.
  const corrected = await prisma.interaction.create({
    data: { clientId: sahyadri.id, type: "MEETING", occurredAt: daysAgo(10), summary: "Price band finalised at ₹142–150 with the lead manager.", loggedById: rm1.id, editedAt: daysAgo(9), editedById: admin.id },
  });
  await prisma.interactionRevision.create({
    data: {
      interactionId: corrected.id, previousType: "MEETING", previousOccurredAt: daysAgo(10), previousSummary: "Price band finalised at ₹140–148 with the lead manager.",
      reason: "RM recorded the draft band; corrected to the final band per board resolution", editedById: admin.id, createdAt: daysAgo(9),
    },
  });

  // ─── Tasks ─────────────────────────────────────────────────────────────
  const now = Date.now();
  const endToday = endOfZonedDay(new Date()).getTime();
  const laterToday = new Date(Math.max(now + 10 * 60 * 1000, Math.min(now + 3 * 3_600_000, endToday - 15 * 60 * 1000)));
  const inDays = (n: number, hour = 11) => new Date(endToday + 1 + (n - 1) * DAY + hour * 3_600_000);
  await prisma.task.createMany({
    data: [
      { title: "Send IPO readiness checklist to Vardhaman", leadId: vardhaman.id, dueAt: hoursAgo(20), priority: "HIGH", assignedToId: rm1.id, createdById: rm1.id },
      { title: "Share day-2 subscription status with Sahyadri promoter", description: "Include category-wise subscription and anchor lock-in note.", clientId: sahyadri.id, dueAt: laterToday, priority: "HIGH", assignedToId: rm1.id, createdById: rm1.id },
      { title: "Discovery call follow-up: Kulkarni Agritech", leadId: kulkarni.id, dueAt: inDays(2), priority: "MEDIUM", assignedToId: rm1.id, createdById: rm1.id },
      { title: "Post-listing compliance calendar for Nilgiri", clientId: clients["Nilgiri Foods Ltd"].id, dueAt: inDays(9, 15), priority: "LOW", assignedToId: rm1.id, createdById: admin.id },
      { title: "Collect 3-year audited financials from Iyer Precision", leadId: iyer.id, dueAt: hoursAgo(50), priority: "MEDIUM", assignedToId: rm2.id, createdById: rm2.id },
      { title: "Send valuation proposal to Reddy Pharma", clientId: clients["Reddy Pharma Formulations Pvt Ltd"].id, dueAt: inDays(1), priority: "HIGH", assignedToId: rm2.id, createdById: rm2.id },
      { title: "Review Patel Precision onboarding KYC", clientId: clients["Patel Precision Engineering Pvt Ltd"].id, dueAt: laterToday, priority: "HIGH", assignedToId: compliance.id, createdById: compliance.id },
    ],
  });
  await prisma.task.create({
    data: { title: "Circulate Nilgiri listing-day note", clientId: clients["Nilgiri Foods Ltd"].id, dueAt: daysAgo(12), priority: "MEDIUM", status: "DONE", completedAt: daysAgo(12), assignedToId: rm1.id, createdById: rm1.id },
  });

  // ─── Meetings ──────────────────────────────────────────────────────────
  const at = (dayOffset: number, hour: number, minute = 0) => new Date(endToday + 1 + (dayOffset - 1) * DAY + (hour * 60 + minute) * 60_000);
  const kaveri = clients["Kaveri Agro Foods Ltd"];
  await prisma.meeting.createMany({
    data: [
      {
        title: "Listing-day plan with Sahyadri promoters", agenda: "Listing ceremony logistics, price-stabilisation, investor communication.",
        startAt: at(1, 11), endAt: at(1, 11, 45), provider: "GOOGLE_MEET", joinUrl: "https://meet.google.com/sample-link", organizerId: rm1.id, clientId: sahyadri.id,
        mandateId: sahyadriIpoMandate, attendees: [{ email: "suresh@sahyadrirenewables.in", name: "Suresh Patil" }, { email: "anita.d@sahyadrirenewables.in", name: "Anita Deshpande" }],
      },
      {
        title: "DRHP drafting session – business & risk factors", startAt: at(3, 15), endAt: at(3, 16, 30), provider: "TEAMS", joinUrl: "https://teams.microsoft.com/l/meetup-join/sample",
        organizerId: rm2.id, clientId: kaveri.id, mandateId: mandates["Kaveri Agro Foods Ltd|MAINBOARD_IPO"], attendees: [{ email: "latha.rao@kaveriagro.com", name: "Latha Rao" }],
      },
      {
        title: "Discovery call – IPO readiness", startAt: at(2, 12), endAt: at(2, 12, 30), provider: "PHONE", location: "+91 98200 11223",
        organizerId: rm1.id, leadId: vardhaman.id, attendees: [{ email: "ankit@vardhamanpolymers.in", name: "Ankit Verma" }],
      },
      {
        title: "Anchor investor roadshow debrief", startAt: daysAgo(6), endAt: new Date(daysAgo(6).getTime() + 3_600_000), provider: "IN_PERSON", location: "BKC, Mumbai",
        organizerId: rm1.id, clientId: sahyadri.id, status: "COMPLETED", outcome: "Three anchor investors committed; allocation finalised with the BRLM.",
        attendees: [{ email: "suresh@sahyadrirenewables.in", name: "Suresh Patil" }],
      },
    ],
  });

  // ─── Email conversations (samples, as if captured from Gmail) ─────────
  const email = (o: { client?: string; lead?: string; user: string; thread: string; subject: string; from: [string, string]; to: string[]; body: string; age: number; out: boolean }) =>
    prisma.emailMessage.create({
      data: {
        provider: "GOOGLE", externalId: `sample-${randomUUID()}`, threadId: o.thread, subject: o.subject, snippet: o.body.slice(0, 140), bodyText: o.body,
        fromEmail: o.from[0], fromName: o.from[1], toEmails: o.to, ccEmails: [], sentAt: hoursAgo(o.age), direction: o.out ? "OUTBOUND" : "INBOUND",
        userId: o.user, clientId: o.client, leadId: o.lead,
      },
    });
  await email({ client: sahyadri.id, user: rm1.id, thread: "t-sahyadri-1", subject: "Day 1 subscription status – Sahyadri Renewables IPO", from: ["rohan@beipoready.com", "Rohan Sharma"], to: ["suresh@sahyadrirenewables.in"], body: "Dear Suresh ji,\n\nDay 1 closed at 2.4x overall (QIB 1.1x, NII 3.2x, retail 2.9x). We expect strong retail momentum tomorrow.\n\nRegards,\nRohan", age: 20, out: true });
  await email({ client: sahyadri.id, user: rm1.id, thread: "t-sahyadri-1", subject: "Re: Day 1 subscription status – Sahyadri Renewables IPO", from: ["suresh@sahyadrirenewables.in", "Suresh Patil"], to: ["rohan@beipoready.com"], body: "Thanks Rohan. Please share category-wise numbers again at 3 pm tomorrow.", age: 18, out: false });
  await email({ client: kaveri.id, user: rm2.id, thread: "t-kaveri-1", subject: "DRHP chapter drafts for review", from: ["priya@beipoready.com", "Priya Nair"], to: ["latha.rao@kaveriagro.com"], body: "Hi Latha,\n\nAttached are the Business Overview and Risk Factors chapters. Comments by Friday would keep us on track for filing.\n\nPriya", age: 26, out: true });

  // ─── Notifications (history) ───────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { userId: compliance.id, type: "KYC_STATUS", title: "KYC submitted: Patel Precision Engineering Pvt Ltd", body: "Pending → Submitted by Rohan Sharma", link: `/clients/${clients["Patel Precision Engineering Pvt Ltd"].id}`, createdAt: daysAgo(14) },
      { userId: rm1.id, type: "MANDATE_STAGE", title: "New mandate assigned: Growth capital – ₹18 Cr private placement", body: "Patel Precision Engineering Pvt Ltd", link: `/mandates/${mandates["Patel Precision Engineering Pvt Ltd|FUND_RAISING"]}`, createdAt: daysAgo(55), readAt: daysAgo(54) },
      { userId: rm1.id, type: "LEAD_ASSIGNED", title: "New lead assigned: Vardhaman Polymers Pvt Ltd", body: "Assigned by Rakesh Doshi", link: `/leads/${vardhaman.id}`, createdAt: daysAgo(1) },
      { userId: rm2.id, type: "LEAD_ASSIGNED", title: "New lead assigned: Menon Healthcare Services Pvt Ltd", body: "Assigned by Rakesh Doshi", link: `/leads/${(await leadByCompany("Menon Healthcare Services Pvt Ltd")).id}`, createdAt: daysAgo(3) },
    ],
  });

  // ─── Company profile ───────────────────────────────────────────────────
  // Other contact details are left blank on purpose; fill them in under Settings.
  // The firm email is the system mailbox: invitations go out from the admin's connected account.
  const profile = {
    firmName: "Be IPO Ready",
    tagline: "India's leading IPO advisor & growth capital expert",
    website: "https://beipoready.com",
    phone: null,
    email: ADMIN_EMAIL,
    sebiRegistration: null,
    address: null,
    systemSenderUserId: admin.id,
    // No SMTP until an admin enters it under Settings → System email.
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    smtpPass: null,
    smtpFrom: null,
    smtpSecure: false,
  };
  await prisma.companyProfile.upsert({ where: { id: 1 }, create: { id: 1, ...profile }, update: { ...profile, logoKey: null, logoMime: null } });

  console.log(`Seeded. Admin password: ${ADMIN_PASSWORD} · all other users: ${PASSWORD}`);
  console.table([
    { role: "Admin (CEO, system mailbox)", email: admin.email },
    { role: "Compliance", email: compliance.email },
    { role: "RM", email: rm1.email },
    { role: "RM", email: rm2.email },
    { role: "Viewer", email: "viewer@beipoready.com" },
  ]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
