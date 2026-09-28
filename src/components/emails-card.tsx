"use client";

import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/layout";
import { Button, ErrorText, Field, Input, Modal, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export type EmailRow = {
  id: string;
  threadId: string | null;
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  sentAt: string;
  direction: "INBOUND" | "OUTBOUND";
  mailbox: string; // CRM user whose mailbox captured it
};

type Parent = { leadId?: string; clientId?: string };

/** Email conversations with the company, captured from connected Gmail / Outlook mailboxes. */
export function EmailsCard({
  parent,
  emails,
  recipients,
  connected,
  canSend,
}: {
  parent: Parent;
  emails: EmailRow[];
  recipients: { name: string; email: string }[];
  connected: { google: boolean; microsoft: boolean; firmMailbox?: boolean };
  canSend: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState<{ to?: string; subject?: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  // Sending goes through the firm mailbox; only a user's own Google / Microsoft account can be read (sync).
  const anyConnected = !!connected.firmMailbox;
  const canSync = connected.google || connected.microsoft;

  const threads = useMemo(() => {
    const map = new Map<string, EmailRow[]>();
    for (const e of emails) {
      const key = e.threadId ?? e.subject.replace(/^(re|fwd?):\s*/i, "").toLowerCase();
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()]
      .map(([key, msgs]) => ({ key, msgs: msgs.sort((a, b) => a.sentAt.localeCompare(b.sentAt)) }))
      .sort((a, b) => b.msgs[b.msgs.length - 1].sentAt.localeCompare(a.msgs[a.msgs.length - 1].sentAt));
  }, [emails]);

  async function sync() {
    setSyncing(true);
    try {
      await api("/api/integrations/sync", "POST");
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card
      title={`Email conversations${emails.length ? ` (${threads.length})` : ""}`}
      actions={
        <div className="flex items-center gap-1">
          {canSync && (
            <Button size="sm" variant="ghost" onClick={sync} loading={syncing} title="Fetch new emails from your mailbox">
              {!syncing && <RefreshCw size={13} />} Sync
            </Button>
          )}
          {canSend && (
            <Button size="sm" onClick={() => setComposing({})} disabled={!anyConnected} title={anyConnected ? undefined : "An administrator needs to set up the firm mailbox under Settings → System email"}>
              + Email
            </Button>
          )}
        </div>
      }
    >
      {threads.length === 0 ? (
        <EmptyState
          title="No emails captured yet"
          description={canSync ? "Emails with this company's contacts appear here after a sync." : anyConnected ? "Emails you send from the CRM appear here (sent from the firm mailbox as you; replies come to your inbox)." : "Once the firm mailbox is set up under Settings, emails you send from the CRM appear here."}
        />
      ) : (
        <ul className="divide-y divide-gray-100" data-testid="email-threads">
          {threads.map(({ key, msgs }) => {
            const last = msgs[msgs.length - 1];
            const isOpen = open.has(key);
            return (
              <li key={key} data-testid="email-thread">
                <button
                  className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left hover:bg-gray-50"
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(key)) n.delete(key);
                      else n.add(key);
                      return n;
                    })
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {last.subject} {msgs.length > 1 && <span className="font-normal text-gray-400">({msgs.length})</span>}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {last.direction === "INBOUND" ? last.fromName || last.fromEmail : `You → ${last.toEmails.join(", ")}`} · {last.snippet}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{formatDateTime(last.sentAt)}</span>
                </button>
                {isOpen && (
                  <div className="space-y-2 bg-gray-50/60 px-5 pb-3">
                    {msgs.map((m) => (
                      <div key={m.id} className={clsx("rounded-lg border bg-white p-3 text-sm", m.direction === "OUTBOUND" ? "border-brand-100" : "border-gray-200")} data-testid="email-message">
                        <p className="flex items-center gap-1.5 text-xs text-gray-500">
                          {m.direction === "INBOUND" ? <ArrowDownLeft size={12} className="text-emerald-600" /> : <ArrowUpRight size={12} className="text-brand-600" />}
                          <span className="font-medium text-gray-800">{m.fromName || m.fromEmail}</span> → {m.toEmails.join(", ")}
                          {m.ccEmails.length > 0 && <> · cc {m.ccEmails.join(", ")}</>}
                          <span className="ml-auto">{formatDateTime(m.sentAt)}</span>
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-gray-800">{m.bodyText ?? m.snippet}</p>
                        <p className="mt-1 text-[11px] text-gray-400">Captured from {m.mailbox}&apos;s mailbox</p>
                      </div>
                    ))}
                    {canSend && anyConnected && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setComposing({ to: last.direction === "INBOUND" ? last.fromEmail : last.toEmails[0], subject: /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}` })}
                      >
                        Reply
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {composing && <ComposeModal parent={parent} recipients={recipients} connected={connected} initial={composing} onClose={() => setComposing(null)} />}
    </Card>
  );
}

function ComposeModal({
  parent,
  recipients,
  connected,
  initial,
  onClose,
}: {
  parent: Parent;
  recipients: { name: string; email: string }[];
  connected: { google: boolean; microsoft: boolean; firmMailbox?: boolean };
  initial: { to?: string; subject?: string };
  onClose: () => void;
}) {
  const router = useRouter();
  void connected;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const list = (s: FormDataEntryValue | null) =>
    String(s ?? "")
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await api("/api/emails", "POST", { ...parent, to: list(f.get("to")), cc: list(f.get("cc")), subject: f.get("subject"), body: f.get("body") });
      onClose();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New email"
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="compose-email" loading={loading}>
            Send
          </Button>
        </>
      }
    >
      <form id="compose-email" onSubmit={submit} className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <p className="text-xs text-gray-500">Sent from the firm mailbox as you; replies come to your own inbox.</p>
        <Field label="To" htmlFor="em-to" hint={recipients.length ? `Contacts: ${recipients.map((r) => `${r.name} <${r.email}>`).join(", ")}` : undefined}>
          <Input id="em-to" name="to" defaultValue={initial.to ?? recipients[0]?.email ?? ""} required />
        </Field>
        <Field label="Cc" htmlFor="em-cc">
          <Input id="em-cc" name="cc" />
        </Field>
        <Field label="Subject" htmlFor="em-subject">
          <Input id="em-subject" name="subject" defaultValue={initial.subject ?? ""} required />
        </Field>
        <Field label="Message" htmlFor="em-body">
          <Textarea id="em-body" name="body" rows={8} required />
        </Field>
      </form>
    </Modal>
  );
}
