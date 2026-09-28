/**
 * Minimal iCalendar (RFC 5545) builder for meeting invitations sent by plain
 * email (SMTP mailboxes). Gmail, Outlook and Apple Mail show these as proper
 * invites with Accept / Decline; METHOD:CANCEL withdraws them.
 */

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets, as the spec requires. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let i = 75;
    while (Buffer.byteLength(rest.slice(0, i)) > 75) i--;
    out.push(rest.slice(0, i));
    rest = ` ${rest.slice(i)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export type IcsEvent = {
  uid: string;
  method: "REQUEST" | "CANCEL";
  sequence?: number;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  organizer: { name: string; email: string };
  attendees: { name?: string | null; email: string }[];
};

export function buildIcs(e: IcsEvent) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Be IPO Ready CRM//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.startAt)}`,
    `DTEND:${stamp(e.endAt)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    `ORGANIZER;CN=${esc(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map((a) => `ATTENDEE;CN=${esc(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
