/**
 * Plain-text meeting details for sharing by email or WhatsApp. Isomorphic:
 * used by API routes (to send from the organiser's mailbox) and by client
 * components (to build wa.me links and "copy details").
 */
import type { MeetingProvider } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
import { APP_TIMEZONE } from "@/lib/tz";
import { formatWhatsApp } from "@/lib/whatsapp";

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit" });
const tzLabel = APP_TIMEZONE === "Asia/Kolkata" ? "IST" : APP_TIMEZONE;

const PROVIDER_NAMES: Record<MeetingProvider, string> = {
  GOOGLE_MEET: "Google Meet",
  TEAMS: "Microsoft Teams",
  ZOOM: "Zoom",
  PHONE: "Phone call",
  IN_PERSON: "In person",
  OTHER: "Online meeting",
};

export type ShareableMeeting = {
  title: string;
  agenda: string | null;
  startAt: string | Date;
  endAt: string | Date;
  provider: MeetingProvider;
  joinUrl: string | null;
  location: string | null;
  organizerDetails: { name: string; designation: string | null; whatsapp: string | null; email: string };
};

/** "Tue, 30 Sept 2026, 11:00 am – 11:30 am IST" */
export function meetingWhen(m: Pick<ShareableMeeting, "startAt" | "endAt">) {
  return `${formatDateTime(m.startAt)} – ${timeFmt.format(new Date(m.endAt))} ${tzLabel}`;
}

/** The organiser's signature: name, designation, firm and their own channels. */
export function organiserSignature(o: ShareableMeeting["organizerDetails"], firmName: string) {
  const who = [o.name, o.designation].filter(Boolean).join(", ");
  const channels = [o.whatsapp ? `WhatsApp ${formatWhatsApp(o.whatsapp)}` : null, o.email].filter(Boolean).join(" · ");
  return `— ${who} · ${firmName}${channels ? `\n${channels}` : ""}`;
}

export function meetingShareText(m: ShareableMeeting, firmName: string, opts: { greeting?: string | null; intro?: string | null } = {}) {
  const lines = [
    ...(opts.greeting ? [opts.greeting, ""] : []),
    ...(opts.intro ? [opts.intro, ""] : []),
    `Meeting: ${m.title}`,
    `When: ${meetingWhen(m)}`,
  ];
  if (m.joinUrl) lines.push(`Join (${PROVIDER_NAMES[m.provider]}): ${m.joinUrl}`);
  if (m.location) lines.push(`${m.provider === "PHONE" ? "Dial" : "Where"}: ${m.location}`);
  if (!m.joinUrl && !m.location) lines.push(`How: ${PROVIDER_NAMES[m.provider]}`);
  if (m.agenda) lines.push("", `Agenda: ${m.agenda}`);
  lines.push("", organiserSignature(m.organizerDetails, firmName));
  return lines.join("\n");
}

/** Subject + body for an invitation email sent from the organiser's own mailbox. */
export function meetingInviteEmail(m: ShareableMeeting, firmName: string, recipientName?: string | null) {
  return {
    subject: `Meeting: ${m.title} — ${formatDateTime(m.startAt)}`,
    body: meetingShareText(m, firmName, {
      greeting: `Hi ${recipientName?.split(" ")[0] || "there"},`,
      intro: `${m.organizerDetails.name} from ${firmName} has scheduled a meeting with you. The details are below — please reply to this email if the time doesn't work.`,
    }),
  };
}
