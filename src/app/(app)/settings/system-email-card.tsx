"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ErrorText, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api-client";
import { impliedSecure, SMTP_PRESETS, smtpPresetByHost, smtpPresetById } from "@/lib/smtp-presets";

type Admin = { id: string; name: string; email: string; mailboxes: string[] };
type Sender = { userId: string | null; method: string | null; fromEmail: string | null; summary: string };
export type SmtpView = { host: string; port: number; user: string | null; from: string; secure: boolean; source: "settings" | "env"; hasPassword: boolean; passwordUnreadable?: boolean } | null;

const METHOD: Record<string, string> = { GOOGLE: "Gmail", MICROSOFT: "Outlook", SMTP: "SMTP" };

/** The firm mailbox: every user's emails, meeting invitations and the system's own invitations go out from it (as "<user> via <firm>", replies to the user). */
export function SystemEmailCard({ sender, admins, smtp, currentUserId }: { sender: Sender; admins: Admin[]; smtp: SmtpView; currentUserId: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState(sender.userId ?? "");
  const [busy, setBusy] = useState<"sender" | "smtp" | "remove" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isMe = sender.userId === currentUserId;
  const stored = smtp?.source === "settings" ? smtp : null;
  // SMTP server fields are controlled so a provider choice can fill them in.
  const [provider, setProvider] = useState<string>(stored ? (smtpPresetByHost(stored.host)?.id ?? "custom") : "gmail");
  const [host, setHost] = useState(stored?.host ?? "smtp.gmail.com");
  const [port, setPort] = useState<number>(stored?.port ?? 587);
  const [secure, setSecure] = useState<boolean>(stored ? impliedSecure(stored.port, stored.secure) : false);
  const preset = smtpPresetById(provider);
  function chooseProvider(id: string) {
    setProvider(id);
    const p = smtpPresetById(id);
    if (p) {
      setHost(p.host);
      setPort(p.port);
      setSecure(p.secure);
    }
  }
  function changePort(v: string) {
    const n = Number(v) || 0;
    setPort(n);
    setSecure(impliedSecure(n, n === 465 ? true : false));
  }

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<string>) {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const saveSender = () =>
    run("sender", async () => {
      const r = await api<{ summary: string }>("/api/settings/system-email", "PATCH", { systemSenderUserId: userId || null });
      return `Saved. ${r.summary}`;
    });

  const saveSmtp = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    return run("smtp", async () => {
      const r = await api<{ summary: string }>("/api/settings/system-email", "PATCH", {
        smtp: { host, port, user: f.get("user"), pass: f.get("pass"), from: f.get("from"), secure: impliedSecure(port, secure) },
      });
      return `SMTP saved. ${r.summary}`;
    });
  };

  const removeSmtp = () => {
    if (!confirm("Remove the stored SMTP settings?")) return;
    return run("remove", async () => {
      const r = await api<{ summary: string }>("/api/settings/system-email", "PATCH", { smtp: null });
      return `SMTP settings removed. ${r.summary}`;
    });
  };

  const test = () =>
    run("test", async () => {
      const r = await api<{ sent: boolean; via?: string; from?: string; reason?: string }>("/api/settings/system-email", "POST");
      if (!r.sent) throw new Error(`Couldn't send: ${r.reason}`);
      return `Test email sent to you from ${r.from} via ${METHOD[r.via ?? ""] ?? r.via}. Check your inbox.`;
    });

  return (
    <div className="space-y-5 px-5 py-4 text-sm text-gray-700" data-testid="system-email">
      <ErrorText>{error}</ErrorText>
      {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5">
        <dt className="text-gray-500">Sends from</dt>
        <dd className="flex items-center gap-2">
          {sender.fromEmail ?? "—"} {sender.method ? <Badge tone="green">{METHOD[sender.method] ?? sender.method}</Badge> : <Badge tone="amber">Not set up</Badge>}
        </dd>
        <dt className="text-gray-500">Status</dt>
        <dd data-testid="system-email-summary">{sender.summary}</dd>
      </dl>

      <Field label="Mailbox owner (administrator)" htmlFor="se-user" hint="If this administrator has connected Gmail or Outlook under My account, that account is used; otherwise the SMTP settings below are.">
        <div className="flex gap-2">
          <Select
            id="se-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="First admin with a connected mailbox"
            options={admins.map((a) => ({ value: a.id, label: `${a.name} · ${a.email}${a.mailboxes.length ? ` (connected: ${a.mailboxes.join(", ")})` : " (no mailbox connected)"}` }))}
          />
          <Button variant="secondary" onClick={saveSender} loading={busy === "sender"}>
            Save
          </Button>
        </div>
      </Field>
      {isMe && !sender.method && (
        <p className="text-xs text-gray-500">
          You are the system sender: connect Google or Microsoft under{" "}
          <a href="/account" className="font-medium text-brand-600 hover:underline">
            My account
          </a>{" "}
          and invitations will go out from your mailbox — or fill in SMTP below.
        </p>
      )}

      <form onSubmit={saveSmtp} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4" data-testid="smtp-form">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-900">
            SMTP {stored ? <Badge tone="green">Configured</Badge> : smtp?.source === "env" ? <Badge tone="blue">From server environment</Badge> : <Badge>Not configured</Badge>}
          </p>
          <p className="text-xs text-gray-500">Choose the provider and the server settings fill in; you only add the address and password.</p>
        </div>
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-6">
            <Field label="Email provider" htmlFor="smtp-provider" hint={preset?.help ?? "Enter the SMTP host and port from your email provider."}>
              <Select id="smtp-provider" value={provider} onChange={(e) => chooseProvider(e.target.value)} options={[...SMTP_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Other (enter SMTP host)" }]} />
            </Field>
          </div>
          <div className="col-span-4">
            <Field label="SMTP host" htmlFor="smtp-host">
              <Input id="smtp-host" name="host" value={host} onChange={(e) => (setHost(e.target.value), setProvider(smtpPresetByHost(e.target.value)?.id ?? "custom"))} placeholder="smtp.example.com" required />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Port" htmlFor="smtp-port">
              <Input id="smtp-port" name="port" type="number" min={1} max={65535} value={port || ""} onChange={(e) => changePort(e.target.value)} required />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="Username" htmlFor="smtp-user">
              <Input id="smtp-user" name="user" defaultValue={stored?.user ?? ""} placeholder="admin@beipoready.com" autoComplete="off" />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="Password / app password" htmlFor="smtp-pass" hint={stored?.passwordUnreadable ? "The saved password can't be read on this deployment — enter it again." : stored?.hasPassword ? "Leave blank to keep the saved password." : undefined}>
              <Input id="smtp-pass" name="pass" type="password" placeholder={stored?.hasPassword && !stored.passwordUnreadable ? "••••••••••••" : ""} autoComplete="new-password" required={!!stored?.passwordUnreadable} />
            </Field>
          </div>
          <div className="col-span-4">
            <Field label="From address" htmlFor="smtp-from" hint="Must be an address the SMTP account may send as.">
              <Input id="smtp-from" name="from" type="email" defaultValue={stored?.from ?? ""} placeholder="admin@beipoready.com" required />
            </Field>
          </div>
          <label className="col-span-2 flex items-center gap-2 self-end pb-2 text-sm text-gray-700" title="Port 465 always uses implicit TLS; 587 negotiates STARTTLS">
            <input type="checkbox" name="secure" checked={impliedSecure(port, secure)} disabled={port === 465} onChange={(e) => setSecure(e.target.checked)} className="rounded border-gray-300" /> Implicit TLS {port === 465 ? "(on for port 465)" : ""}
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {stored && (
            <Button type="button" variant="ghost" onClick={removeSmtp} loading={busy === "remove"}>
              Remove SMTP settings
            </Button>
          )}
          <Button type="submit" variant="secondary" loading={busy === "smtp"}>
            Save SMTP
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-500">Every user sends from this address as “their name via the firm”, and replies go to their own inbox. Until it is set up, invitation links can still be copied or sent on WhatsApp from the Users page.</p>
        <Button size="sm" variant="secondary" onClick={test} loading={busy === "test"} data-testid="send-test-email">
          Send test email to me
        </Button>
      </div>
    </div>
  );
}
