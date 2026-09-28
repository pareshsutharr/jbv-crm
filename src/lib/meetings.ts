import type { IntegrationProvider, MeetingProvider, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, type CurrentUser } from "@/lib/session";
import { optionalText } from "@/lib/validation";

export const MEETING_PROVIDERS = ["GOOGLE_MEET", "TEAMS", "ZOOM", "PHONE", "IN_PERSON", "OTHER"] as const satisfies readonly MeetingProvider[];

export const MEETING_PROVIDER_LABELS: Record<MeetingProvider, string> = {
  GOOGLE_MEET: "Google Meet",
  TEAMS: "Microsoft Teams",
  ZOOM: "Zoom (paste link)",
  PHONE: "Phone call",
  IN_PERSON: "In person",
  OTHER: "Other",
};

/** Which connected account a provider needs to auto-create the video link. */
export const REQUIRED_ACCOUNT: Partial<Record<MeetingProvider, IntegrationProvider>> = { GOOGLE_MEET: "GOOGLE", TEAMS: "MICROSOFT" };

/** An attendee needs an email (for calendar invites) and/or a phone number (for WhatsApp). */
const attendee = z
  .object({
    email: z
      .union([z.literal(""), z.string().trim().toLowerCase().email("Invalid attendee email")])
      .optional()
      .nullable()
      .transform((v) => v || null),
    name: optionalText(120),
    phone: optionalText(40),
  })
  .refine((a) => a.email || a.phone, "Each attendee needs an email or a phone number");
export type MeetingAttendee = { email: string | null; name: string | null; phone: string | null };

export const meetingCreateSchema = z
  .object({
    title: z.string().trim().min(3, "Give the meeting a title").max(200),
    agenda: optionalText(3000),
    startAt: z
      .string()
      .transform((s) => new Date(s))
      .refine((d) => !isNaN(d.getTime()), "Enter a valid start time"),
    durationMin: z.coerce.number().int().min(5).max(24 * 60).default(30),
    provider: z.enum(MEETING_PROVIDERS),
    attendees: z.array(attendee).max(50).default([]),
    location: optionalText(300),
    joinUrl: z
      .union([z.literal(""), z.string().trim().url("Enter a valid meeting link")])
      .optional()
      .nullable()
      .transform((v) => v || null),
    addToCalendar: z.boolean().default(true),
    leadId: z.string().optional().nullable().transform((v) => v || null),
    clientId: z.string().optional().nullable().transform((v) => v || null),
    mandateId: z.string().optional().nullable().transform((v) => v || null),
  })
  .refine((v) => !!v.leadId !== !!v.clientId, "Link the meeting to a lead or a client");

export const meetingUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), outcome: z.string().trim().min(3, "Summarise the outcome").max(5000) }),
  z.object({ action: z.literal("cancel"), reason: optionalText(500) }),
]);

export const meetingInclude = {
  organizer: { select: { id: true, name: true, designation: true, whatsapp: true, email: true } },
  lead: { select: { id: true, companyName: true, assignedRmId: true } },
  client: { select: { id: true, name: true, assignedRmId: true } },
  mandate: { select: { id: true, code: true } },
} as const satisfies Prisma.MeetingInclude;

type Row = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;

export function toMeetingRow(m: Row, user: CurrentUser) {
  return {
    id: m.id,
    title: m.title,
    agenda: m.agenda,
    startAt: m.startAt.toISOString(),
    endAt: m.endAt.toISOString(),
    provider: m.provider,
    joinUrl: m.joinUrl,
    location: m.location,
    attendees: ((m.attendees as Partial<MeetingAttendee>[] | null) ?? []).map((a) => ({ email: a.email ?? null, name: a.name ?? null, phone: a.phone ?? null })),
    status: m.status,
    outcome: m.outcome,
    organizer: m.organizer.name,
    organizerDetails: { name: m.organizer.name, designation: m.organizer.designation, whatsapp: m.organizer.whatsapp, email: m.organizer.email },
    inCalendar: !!m.externalEventId,
    related: m.client ? { kind: "client" as const, id: m.client.id, name: m.client.name } : m.lead ? { kind: "lead" as const, id: m.lead.id, name: m.lead.companyName } : null,
    mandate: m.mandate,
    canManage: user.role === "ADMIN" || m.organizerId === user.id,
  };
}
export type MeetingRow = ReturnType<typeof toMeetingRow>;

export async function loadMeetingForUser(user: CurrentUser, id: string) {
  const m = await prisma.meeting.findUnique({ where: { id }, include: meetingInclude });
  if (!m) throw new HttpError(404, "Meeting not found");
  const parent = m.client ?? m.lead;
  if (user.role === "RM" && parent?.assignedRmId !== user.id && m.organizerId !== user.id) throw new HttpError(404, "Meeting not found");
  return m;
}
