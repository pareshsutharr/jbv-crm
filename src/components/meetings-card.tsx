"use client";

import type { MeetingProvider } from "@prisma/client";
import clsx from "clsx";
import { CalendarCheck, Check, Copy, Mail, MapPin, MessageCircle, Phone, Share2, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/layout";
import { Badge, Button, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { meetingShareText, meetingWhen } from "@/lib/meeting-share";
import type { MeetingRow } from "@/lib/meetings";
import { formatWhatsApp, whatsappUrl } from "@/lib/whatsapp";

const PROVIDER_LABELS: Record<MeetingProvider, string> = {
  GOOGLE_MEET: "Google Meet",
  TEAMS: "Microsoft Teams",
  ZOOM: "Zoom (paste link)",
  PHONE: "Phone call",
  IN_PERSON: "In person",
  OTHER: "Other",
};

type ContactOption = { name: string; email: string | null; phone?: string | null };
type Parent = { leadId?: string; clientId?: string };
/** The signed-in user's own channels (from My account). */
type Me = { whatsapp: string | null; meetingLink: string | null; whatsappLinked?: boolean };
type Connected = { google: boolean; microsoft: boolean; firmMailbox?: boolean };

function nextSlot() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const firstName = (s: string | null | undefined) => (s ?? "").trim().split(" ")[0];

/**
 * Share the meeting details the way the user works: WhatsApp (opens their own
 * WhatsApp with the message prefilled — sent from their number), email from
 * their connected mailbox, or copy to paste anywhere.
 */
export function ShareActions({ m, firmName, layout = "row", whatsappLinked = false }: { m: MeetingRow; firmName: string; layout?: "row" | "stack"; whatsappLinked?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState<{ busy: boolean; result: string | null; error: string | null }>({ busy: false, result: null, error: null });
  const [wa, setWa] = useState<{ busy: string | null; result: string | null; error: string | null }>({ busy: null, result: null, error: null });
  const [copied, setCopied] = useState(false);
  const text = meetingShareText(m, firmName);
  const withPhone = m.attendees.filter((a) => a.phone);
  const withEmail = m.attendees.filter((a) => a.email);

  async function openWhatsApp(a?: { phone: string | null; name: string | null }) {
    if (whatsappLinked && a?.phone) {
      // Linked WhatsApp: the CRM sends it from the user's own number.
      setWa({ busy: a.phone, result: null, error: null });
      try {
        const r = await api<{ direct: boolean; queued?: boolean; to?: string }>(`/api/meetings/${m.id}/share`, "POST", { channel: "whatsapp", phone: a.phone, name: a.name });
        if (r.direct) {
          setWa({ busy: null, result: r.queued ? `Queued on the firm's WhatsApp for ${firstName(a.name) || r.to}.` : `Sent to ${firstName(a.name) || r.to} on WhatsApp.`, error: null });
          router.refresh();
          return;
        }
      } catch (err) {
        setWa({ busy: null, result: null, error: (err as Error).message });
        return;
      }
      setWa({ busy: null, result: null, error: null });
    }
    window.open(whatsappUrl(text, a?.phone), "_blank", "noopener");
    // Record on the timeline that the details went out on WhatsApp.
    void api(`/api/meetings/${m.id}/share`, "POST", { channel: "whatsapp", phone: a?.phone ?? null, name: a?.name ?? null }).catch(() => undefined);
  }
  async function emailInvite() {
    setEmail({ busy: true, result: null, error: null });
    try {
      const r = await api<{ sentTo: string[]; from: string }>(`/api/meetings/${m.id}/share`, "POST", { channel: "email" });
      setEmail({ busy: false, result: `Emailed to ${r.sentTo.join(", ")} from ${r.from}.`, error: null });
      router.refresh(); // the sent email now sits on the record's timeline
    } catch (err) {
      setEmail({ busy: false, result: null, error: (err as Error).message });
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className={clsx(layout === "stack" ? "flex flex-col items-stretch gap-1.5" : "flex flex-wrap items-center gap-1.5")} data-testid="share-actions">
      {withPhone.length > 0 ? (
        withPhone.map((a) => (
          <Button key={a.phone} size="sm" variant="secondary" onClick={() => openWhatsApp(a)} loading={wa.busy === a.phone} title={whatsappLinked ? `Sends to ${formatWhatsApp(a.phone)} from your linked WhatsApp` : `Opens WhatsApp to ${formatWhatsApp(a.phone)}`} data-testid="share-whatsapp">
            <MessageCircle size={13} className="text-emerald-600" /> WhatsApp {firstName(a.name) || formatWhatsApp(a.phone)}
          </Button>
        ))
      ) : (
        <Button size="sm" variant="secondary" onClick={() => openWhatsApp()} title="Opens WhatsApp; pick the contact there" data-testid="share-whatsapp">
          <MessageCircle size={13} className="text-emerald-600" /> WhatsApp…
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        onClick={emailInvite}
        loading={email.busy}
        disabled={withEmail.length === 0}
        title={withEmail.length ? `Email ${withEmail.map((a) => a.email).join(", ")} from the firm mailbox as you` : "No attendee has an email address"}
        data-testid="share-email"
      >
        <Mail size={13} /> Email invite
      </Button>
      <Button size="sm" variant="ghost" onClick={copy} data-testid="share-copy">
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy details"}
      </Button>
      {email.result && (
        <p className="w-full text-xs text-emerald-700" data-testid="share-result">
          {email.result}
        </p>
      )}
      {wa.result && (
        <p className="w-full text-xs text-emerald-700" data-testid="share-whatsapp-result">
          {wa.result}
        </p>
      )}
      {wa.error && (
        <p className="w-full text-xs text-red-600" data-testid="share-whatsapp-error">
          {wa.error}
        </p>
      )}
      {email.error && (
        <p className="w-full text-xs text-red-600" data-testid="share-error">
          {email.error}
        </p>
      )}
    </div>
  );
}

export function MeetingList({ meetings, showRelated = false, firmName, whatsappLinked = false }: { meetings: MeetingRow[]; showRelated?: boolean; firmName: string; whatsappLinked?: boolean }) {
  const router = useRouter();
  const [closing, setClosing] = useState<{ m: MeetingRow; action: "complete" | "cancel" } | null>(null);
  if (meetings.length === 0) return <EmptyState title="No meetings" />;
  return (
    <>
      <ul className="divide-y divide-gray-100" data-testid="meetings">
        {meetings.map((m) => {
          const Icon = m.provider === "PHONE" ? Phone : m.provider === "IN_PERSON" ? MapPin : Video;
          return (
            <li key={m.id} className="px-5 py-3" data-testid="meeting-row">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={clsx("text-sm font-medium", m.status === "CANCELLED" ? "text-gray-400 line-through" : "text-gray-900")}>{m.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Icon size={12} /> {PROVIDER_LABELS[m.provider].replace(" (paste link)", "")}
                    </span>
                    <span>{formatDateTime(m.startAt)}</span>
                    <span>· {m.organizer}</span>
                    {m.inCalendar && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-700">
                        <CalendarCheck size={11} /> invite sent
                      </span>
                    )}
                    {showRelated && m.related && (
                      <Link href={`/${m.related.kind === "lead" ? "leads" : "clients"}/${m.related.id}`} className="text-brand-600 hover:underline">
                        {m.related.name}
                      </Link>
                    )}
                  </p>
                  {m.attendees.length > 0 && <p className="mt-0.5 truncate text-xs text-gray-500">With {m.attendees.map((a) => a.name || a.email || formatWhatsApp(a.phone)).join(", ")}</p>}
                  {m.outcome && <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">{m.outcome}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {m.status === "SCHEDULED" ? (
                    <div className="flex items-center gap-1">
                      {m.canManage && (
                        <details className="relative">
                          <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900" data-testid="share-menu">
                            <Share2 size={12} /> Share
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                            <ShareActions m={m} firmName={firmName} layout="stack" whatsappLinked={whatsappLinked} />
                          </div>
                        </details>
                      )}
                      {m.joinUrl && (
                        <a href={m.joinUrl} target="_blank" rel="noreferrer" className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700" data-testid="join-link">
                          Join
                        </a>
                      )}
                    </div>
                  ) : (
                    <Badge tone={m.status === "COMPLETED" ? "green" : "gray"}>{m.status === "COMPLETED" ? "Completed" : "Cancelled"}</Badge>
                  )}
                  {m.status === "SCHEDULED" && m.canManage && (
                    <div className="flex gap-1 text-xs">
                      <button className="text-gray-500 hover:text-gray-900" onClick={() => setClosing({ m, action: "complete" })}>
                        Complete
                      </button>
                      <span className="text-gray-300">·</span>
                      <button className="text-red-600 hover:text-red-700" onClick={() => setClosing({ m, action: "cancel" })}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {closing && <CloseMeetingModal {...closing} onClose={() => setClosing(null)} onDone={() => router.refresh()} />}
    </>
  );
}

function CloseMeetingModal({ m, action, onClose, onDone }: { m: MeetingRow; action: "complete" | "cancel"; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/api/meetings/${m.id}`, "PATCH", action === "complete" ? { action, outcome: text } : { action, reason: text });
      onClose();
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={action === "complete" ? "Meeting outcome" : "Cancel meeting"}
      description={action === "complete" ? "Saved to the interaction log as a permanent record." : m.inCalendar ? "Attendees get a cancellation from your calendar." : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" form="close-meeting" variant={action === "cancel" ? "danger" : "primary"} loading={loading}>
            {action === "complete" ? "Save outcome" : "Cancel meeting"}
          </Button>
        </>
      }
    >
      <form id="close-meeting" onSubmit={submit} className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Field label={action === "complete" ? "What was discussed and agreed? Next steps?" : "Reason (optional)"} htmlFor="cm-text">
          <Textarea id="cm-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} required={action === "complete"} minLength={action === "complete" ? 3 : undefined} />
        </Field>
      </form>
    </Modal>
  );
}

const contactKey = (c: ContactOption) => c.email ?? c.phone ?? c.name;

function ScheduleModal({
  parent,
  contacts,
  mandates,
  connected,
  me,
  firmName,
  onClose,
}: {
  parent: Parent;
  contacts: ContactOption[];
  mandates: { id: string; code: string; title: string }[];
  connected: Connected;
  me: Me;
  firmName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<MeetingProvider>(connected.google ? "GOOGLE_MEET" : connected.microsoft ? "TEAMS" : "ZOOM");
  const reachable = contacts.filter((c) => c.email || c.phone);
  const [selected, setSelected] = useState<Set<string>>(new Set(reachable.slice(0, 1).map(contactKey)));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<MeetingRow | null>(null);
  const autoLink = (provider === "GOOGLE_MEET" && connected.google) || (provider === "TEAMS" && connected.microsoft);
  const needsLink = provider === "ZOOM" || provider === "OTHER" || ((provider === "GOOGLE_MEET" || provider === "TEAMS") && !autoLink);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const extra = String(f.get("extra") ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const attendees = [
      ...reachable.filter((c) => selected.has(contactKey(c))).map((c) => ({ email: c.email, name: c.name, phone: c.phone ?? null })),
      ...extra.map((email) => ({ email, name: null, phone: null })),
    ];
    try {
      const { meeting } = await api<{ meeting: MeetingRow }>("/api/meetings", "POST", {
        ...parent,
        title: f.get("title"),
        agenda: f.get("agenda"),
        startAt: new Date(String(f.get("startAt"))).toISOString(),
        durationMin: Number(f.get("durationMin")),
        provider,
        attendees,
        location: f.get("location") ?? "",
        joinUrl: f.get("joinUrl") ?? "",
        mandateId: f.get("mandateId") ?? "",
        addToCalendar: f.get("addToCalendar") === "on",
      });
      router.refresh();
      setCreated(meeting);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <Modal open onClose={onClose} title="Meeting scheduled" description="Send the details from your own accounts, or copy them." footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-4" data-testid="meeting-scheduled">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <p className="font-medium text-gray-900">{created.title}</p>
            <p className="text-xs text-gray-600">{meetingWhen(created)}</p>
            {created.joinUrl && (
              <a href={created.joinUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-brand-600 hover:underline">
                {created.joinUrl}
              </a>
            )}
            {created.inCalendar && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700">
                <CalendarCheck size={11} /> Calendar invite emailed to attendees with an email address.
              </p>
            )}
            {!created.inCalendar && !connected.google && !connected.microsoft && !connected.firmMailbox && (
              <p className="mt-1 text-xs text-gray-500">Calendar invitations are emailed automatically once an administrator sets up the firm mailbox under Settings → System email.</p>
            )}
          </div>
          <ShareActions m={created} firmName={firmName} layout="stack" whatsappLinked={!!me.whatsappLinked} />
          {!me.whatsapp && (
            <p className="text-xs text-gray-500">
              Tip: add your WhatsApp number under{" "}
              <Link href="/account" className="font-medium text-brand-600 hover:underline">
                My account
              </Link>{" "}
              so it appears in your signature.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule meeting"
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-meeting" loading={loading}>
            Schedule
          </Button>
        </>
      }
    >
      <form id="schedule-meeting" onSubmit={submit} className="grid grid-cols-6 gap-3">
        <div className="col-span-6">
          <ErrorText>{error}</ErrorText>
        </div>
        <div className="col-span-6">
          <Field label="Title" htmlFor="mt-title">
            <Input id="mt-title" name="title" defaultValue="IPO readiness discussion" required autoFocus />
          </Field>
        </div>
        <div className="col-span-3">
          <Field label="Starts" htmlFor="mt-start">
            <Input id="mt-start" name="startAt" type="datetime-local" defaultValue={nextSlot()} required />
          </Field>
        </div>
        <div className="col-span-3">
          <Field label="Duration" htmlFor="mt-duration">
            <Select id="mt-duration" name="durationMin" defaultValue="30" options={[15, 30, 45, 60, 90, 120].map((n) => ({ value: String(n), label: `${n} min` }))} />
          </Field>
        </div>
        <div className="col-span-6">
          <Field
            label="Where"
            htmlFor="mt-provider"
            hint={
              autoLink
                ? `A ${provider === "TEAMS" ? "Teams" : "Meet"} link is created in your calendar and invites are emailed to attendees.`
                : provider === "GOOGLE_MEET" || provider === "TEAMS"
                  ? `Connect your ${provider === "TEAMS" ? "Microsoft" : "Google"} account under My account to create links automatically, or paste one below.`
                  : needsLink && me.meetingLink
                    ? "Prefilled with your personal meeting link from My account."
                    : undefined
            }
          >
            <Select id="mt-provider" value={provider} onChange={(e) => setProvider(e.target.value as MeetingProvider)} options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        {needsLink && (
          <div className="col-span-6">
            <Field label="Meeting link" htmlFor="mt-link">
              <Input id="mt-link" name="joinUrl" type="url" placeholder="https://…" defaultValue={me.meetingLink ?? ""} required={provider === "ZOOM"} />
            </Field>
          </div>
        )}
        {(provider === "IN_PERSON" || provider === "PHONE") && (
          <div className="col-span-6">
            <Field label={provider === "PHONE" ? "Dial-in / number" : "Location"} htmlFor="mt-location">
              <Input id="mt-location" name="location" />
            </Field>
          </div>
        )}
        <div className="col-span-6">
          <p className="mb-1.5 text-xs font-medium text-gray-700">Attendees</p>
          <div className="space-y-1">
            {reachable.length === 0 && <p className="text-xs text-gray-500">No contacts with an email or phone yet — add emails below.</p>}
            {reachable.map((c) => {
              const key = contactKey(c);
              return (
                <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={selected.has(key)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(key);
                        else n.delete(key);
                        return n;
                      })
                    }
                  />
                  {c.name}{" "}
                  <span className="text-xs text-gray-400">
                    {c.email ?? "no email"}
                    {c.phone ? ` · WhatsApp ${formatWhatsApp(c.phone)}` : ""}
                  </span>
                </label>
              );
            })}
          </div>
          <Input name="extra" aria-label="Other attendee emails" placeholder="Other emails (comma separated), e.g. your colleague" className="mt-2" />
          <p className="mt-1 text-xs text-gray-500">Attendees with an email get the calendar invite; after scheduling you can also send the details on WhatsApp or from your mailbox.</p>
        </div>
        {mandates.length > 0 && (
          <div className="col-span-6">
            <Field label="Mandate" htmlFor="mt-mandate">
              <Select id="mt-mandate" name="mandateId" options={mandates.map((m) => ({ value: m.id, label: `${m.code} · ${m.title}` }))} placeholder="Not linked" />
            </Field>
          </div>
        )}
        <div className="col-span-6">
          <Field label="Agenda" htmlFor="mt-agenda">
            <Textarea id="mt-agenda" name="agenda" rows={2} />
          </Field>
        </div>
        {(connected.google || connected.microsoft || connected.firmMailbox) && (
          <label className="col-span-6 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="addToCalendar" defaultChecked className="rounded border-gray-300" />{" "}
            {connected.google || connected.microsoft ? "Add to my calendar and email invites" : "Email invitations from the firm mailbox as me (calendar file attached)"}
          </label>
        )}
      </form>
    </Modal>
  );
}

export function MeetingsCard({
  parent,
  meetings,
  contacts,
  mandates = [],
  connected,
  me = { whatsapp: null, meetingLink: null },
  firmName,
  canSchedule,
}: {
  parent: Parent;
  meetings: MeetingRow[];
  contacts: ContactOption[];
  mandates?: { id: string; code: string; title: string }[];
  connected: Connected;
  me?: Me;
  firmName: string;
  canSchedule: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const upcoming = meetings.filter((m) => m.status === "SCHEDULED" && new Date(m.endAt).getTime() >= now);
  const past = meetings.filter((m) => !(m.status === "SCHEDULED" && new Date(m.endAt).getTime() >= now)).reverse();
  return (
    <Card
      title={`Meetings${upcoming.length ? ` · ${upcoming.length} upcoming` : ""}`}
      actions={
        canSchedule && (
          <Button size="sm" onClick={() => setOpen(true)}>
            + Schedule
          </Button>
        )
      }
    >
      {upcoming.length > 0 ? <MeetingList meetings={upcoming} firmName={firmName} whatsappLinked={!!me.whatsappLinked} /> : <EmptyState title="No upcoming meetings" />}
      {past.length > 0 && (
        <details className="border-t border-gray-100">
          <summary className="cursor-pointer px-5 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-800">Past & cancelled ({past.length})</summary>
          <MeetingList meetings={past} firmName={firmName} whatsappLinked={!!me.whatsappLinked} />
        </details>
      )}
      {open && <ScheduleModal parent={parent} contacts={contacts} mandates={mandates} connected={connected} me={me} firmName={firmName} onClose={() => setOpen(false)} />}
    </Card>
  );
}
