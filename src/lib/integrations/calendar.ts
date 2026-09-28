import type { ConnectedAccount } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { GOOGLE, MICROSOFT } from "./config";
import { buildIcs } from "./ics";
import { sendMail } from "./mail";
import { apiFetch, IntegrationError } from "./oauth";

export type CalendarEventInput = {
  title: string;
  agenda: string | null;
  startAt: Date;
  endAt: Date;
  attendees: { email: string; name?: string | null }[];
  location: string | null;
  /** Add a video meeting (Google Meet / Microsoft Teams) to the event. */
  online: boolean;
  /** For SMTP mailboxes: who the invitation email is from and what it says. */
  organizer?: { name: string; email: string };
  invite?: { subject: string; body: string };
};

export type CreatedEvent = { externalEventId: string; joinUrl: string | null; /** SMTP only: the sent invitation email, for the record's timeline. */ email?: { messageId: string | null; subject: string; body: string; to: string[] } };

/**
 * Creates an event in the organiser's calendar; the provider emails the invites.
 * An SMTP mailbox has no calendar: the invitation is emailed with an
 * iCalendar attachment instead, so recipients still get Accept / Decline.
 */
export async function createCalendarEvent(account: ConnectedAccount, e: CalendarEventInput): Promise<CreatedEvent> {
  if (account.provider === "SMTP") {
    if (!e.attendees.length) throw new IntegrationError("No attendee has an email address");
    const uid = `${randomUUID()}@crm`;
    const organizer = e.organizer ?? { name: account.email, email: account.email };
    const ics = buildIcs({ uid, method: "REQUEST", title: e.title, description: e.agenda, location: e.location, startAt: e.startAt, endAt: e.endAt, organizer, attendees: e.attendees });
    const to = e.attendees.map((a) => a.email);
    const subject = e.invite?.subject ?? `Invitation: ${e.title}`;
    const body = e.invite?.body ?? [e.title, e.agenda, e.location].filter(Boolean).join("\n\n");
    const sent = await sendMail(account, { to, cc: [], subject, body, fromName: organizer.name, ical: { method: "REQUEST", content: ics } });
    return { externalEventId: uid, joinUrl: null, email: { messageId: sent.externalId, subject, body, to } };
  }
  if (account.provider === "GOOGLE") {
    const body = {
      summary: e.title,
      description: e.agenda ?? undefined,
      location: e.location ?? undefined,
      start: { dateTime: e.startAt.toISOString() },
      end: { dateTime: e.endAt.toISOString() },
      attendees: e.attendees.map((a) => ({ email: a.email, displayName: a.name ?? undefined })),
      ...(e.online ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    };
    const ev = await apiFetch<{ id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }>(
      account,
      `${GOOGLE.apiUrl()}/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
      { method: "POST", body: JSON.stringify(body) },
    );
    const video = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
    return { externalEventId: ev.id, joinUrl: video };
  }
  const body = {
    subject: e.title,
    body: { contentType: "text", content: e.agenda ?? "" },
    start: { dateTime: e.startAt.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: e.endAt.toISOString().replace("Z", ""), timeZone: "UTC" },
    location: e.location ? { displayName: e.location } : undefined,
    attendees: e.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name ?? a.email }, type: "required" })),
    ...(e.online ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
  const ev = await apiFetch<{ id: string; onlineMeeting?: { joinUrl?: string } | null }>(account, `${MICROSOFT.graphUrl()}/me/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { externalEventId: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null };
}

export type CancelEventInput = Omit<CalendarEventInput, "online" | "invite"> & { reason?: string | null };

/** Cancels the event and notifies attendees. SMTP mailboxes email a cancellation (METHOD:CANCEL). */
export async function cancelCalendarEvent(account: ConnectedAccount, externalEventId: string, comment?: string, event?: CancelEventInput) {
  if (account.provider === "SMTP") {
    if (!event || !event.attendees.length) return;
    const organizer = event.organizer ?? { name: account.email, email: account.email };
    const ics = buildIcs({ uid: externalEventId, method: "CANCEL", sequence: 1, title: event.title, description: event.agenda, location: event.location, startAt: event.startAt, endAt: event.endAt, organizer, attendees: event.attendees });
    await sendMail(account, {
      to: event.attendees.map((a) => a.email),
      cc: [],
      subject: `Cancelled: ${event.title}`,
      body: [`The meeting "${event.title}" has been cancelled.`, comment ? `Reason: ${comment}` : null, `— ${organizer.name}`].filter(Boolean).join("\n\n"),
      fromName: organizer.name,
      ical: { method: "CANCEL", content: ics },
    });
    return;
  }
  if (account.provider === "GOOGLE") {
    await apiFetch(account, `${GOOGLE.apiUrl()}/calendar/v3/calendars/primary/events/${encodeURIComponent(externalEventId)}?sendUpdates=all`, { method: "DELETE" });
    return;
  }
  await apiFetch(account, `${MICROSOFT.graphUrl()}/me/events/${encodeURIComponent(externalEventId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ comment: comment ?? "Meeting cancelled" }),
  });
}
