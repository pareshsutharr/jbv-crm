/**
 * Meeting invitations and cancellations by email from the firm mailbox, with
 * an iCalendar part so the client's mail app shows Accept / Decline.
 */
import { buildIcs } from "@/lib/integrations/ics";
import { meetingInviteEmail, type ShareableMeeting } from "@/lib/meeting-share";
import { sendAsUser } from "@/lib/outgoing-mail";

export type InvitationTarget = { email: string; name?: string | null }[];

export async function emailMeetingInvitation(
  user: { id: string; name: string; email: string },
  m: ShareableMeeting,
  attendees: InvitationTarget,
  opts: { uid: string; firmName: string; method: "REQUEST" | "CANCEL"; reason?: string | null; from: string },
) {
  const organizer = { name: user.name, email: opts.from };
  const ics = buildIcs({
    uid: opts.uid,
    method: opts.method,
    sequence: opts.method === "CANCEL" ? 1 : 0,
    title: m.title,
    description: [m.agenda, m.joinUrl ? `Join: ${m.joinUrl}` : null].filter(Boolean).join("\n\n") || null,
    location: m.joinUrl ?? m.location,
    startAt: new Date(m.startAt),
    endAt: new Date(m.endAt),
    organizer,
    attendees,
  });
  const single = attendees.length === 1 ? attendees[0].name : null;
  const { subject, body } =
    opts.method === "REQUEST"
      ? meetingInviteEmail(m, opts.firmName, single)
      : {
          subject: `Cancelled: ${m.title}`,
          body: [`Hi ${single?.split(" ")[0] || "there"},`, "", `The meeting "${m.title}" has been cancelled.`, opts.reason ? `Reason: ${opts.reason}` : null, "", `— ${user.name}, ${opts.firmName}`].filter((l) => l !== null).join("\n"),
        };
  const to = attendees.map((a) => a.email);
  const sent = await sendAsUser(user, { to, cc: [], subject, body, ical: { method: opts.method, content: ics } });
  return { sent, subject, body, to };
}
