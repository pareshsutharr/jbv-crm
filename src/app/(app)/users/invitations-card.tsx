"use client";

import type { Role } from "@prisma/client";
import { Check, Copy, MessageCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState, Table, Td, Th } from "@/components/layout";
import { Badge, Button, ErrorText, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import type { InvitationRow } from "@/lib/invitations";
import { options, ROLE_LABELS, ROLE_SHORT_LABELS, ROLE_TONE } from "@/lib/labels";
import { whatsappUrl } from "@/lib/whatsapp";

type Result = { invitation: InvitationRow; inviteUrl: string; chatText: string; sent: boolean; sendError: string | null };

const roleOptions = options(ROLE_LABELS);
const VIA: Record<string, string> = { GOOGLE: "Gmail", MICROSOFT: "Outlook", SMTP: "SMTP" };

function chatTextFor(i: InvitationRow, firmName: string) {
  return `Hi ${i.name?.split(" ")[0] || "there"}, ${i.invitedBy} has invited you to the ${firmName} CRM as ${ROLE_LABELS[i.role as Role]}.\nSet up your account here: ${i.inviteUrl}`;
}

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable (insecure context) — the link is visible to select */
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : label}
    </Button>
  );
}

/** After sending / resending: delivery status and ways to share the link by hand. */
function ResultPanel({ r, firmName }: { r: Result; firmName: string }) {
  const i = r.invitation;
  const chat = r.chatText || chatTextFor({ ...i, inviteUrl: r.inviteUrl }, firmName);
  return (
    <div className="space-y-3" data-testid="invite-result">
      {r.sent ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Invitation emailed to <b>{i.email}</b> via {VIA[i.sentVia ?? ""] ?? "the system mailbox"}. It&apos;s valid until {formatDate(i.expiresAt)}.
        </p>
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Couldn&apos;t email the invitation: {r.sendError}. Share the link below instead — it works the same way.
        </p>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-gray-700">Invitation link</p>
        <p className="select-all break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800" data-testid="invite-link">
          {r.inviteUrl}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={r.inviteUrl} />
        <a
          href={whatsappUrl(chat, i.phone)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <MessageCircle size={13} className="text-emerald-600" /> Send on WhatsApp{i.phone ? "" : "…"}
        </a>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onDone, firmName }: { onClose: () => void; onDone: () => void; firmName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<Result>("/api/invitations", "POST", Object.fromEntries(new FormData(e.currentTarget)));
      setResult(r);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={result ? "Invitation created" : "Invite a team member"}
      description={result ? undefined : "They get a link to set their own password, then connect their email and WhatsApp during onboarding."}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="invite-user" loading={loading}>
              <Send size={14} /> Send invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ResultPanel r={result} firmName={firmName} />
      ) : (
        <form id="invite-user" onSubmit={onSubmit} className="space-y-3">
          <ErrorText>{error}</ErrorText>
          <Field label="Work email" htmlFor="iv-email">
            <Input id="iv-email" name="email" type="email" required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" htmlFor="iv-name" hint="Optional; they can change it.">
              <Input id="iv-name" name="name" />
            </Field>
            <Field label="Role" htmlFor="iv-role">
              <Select id="iv-role" name="role" options={roleOptions} defaultValue="RM" />
            </Field>
            <Field label="Designation" htmlFor="iv-designation">
              <Input id="iv-designation" name="designation" placeholder="e.g. Relationship Manager" />
            </Field>
            <Field label="WhatsApp / phone" htmlFor="iv-phone" hint="Optional: lets you send the link on WhatsApp too.">
              <Input id="iv-phone" name="phone" placeholder="+91 " />
            </Field>
          </div>
        </form>
      )}
    </Modal>
  );
}

const STATUS: Record<InvitationRow["status"], { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" }> = {
  pending: { label: "Pending", tone: "blue" },
  expired: { label: "Expired", tone: "amber" },
  accepted: { label: "Accepted", tone: "green" },
  revoked: { label: "Withdrawn", tone: "gray" },
};

export function InvitationsCard({ invitations, firmName }: { invitations: InvitationRow[]; firmName: string }) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [resent, setResent] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function resend(i: InvitationRow) {
    setBusy(i.id);
    try {
      setResent(await api<Result>(`/api/invitations/${i.id}`, "POST"));
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function revoke(i: InvitationRow) {
    if (!confirm(`Withdraw the invitation for ${i.email}? The link will stop working.`)) return;
    setBusy(i.id);
    try {
      await api(`/api/invitations/${i.id}`, "DELETE");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const open = invitations.filter((i) => i.status !== "accepted");
  return (
    <>
      <Card
        title={`Invitations${open.length ? ` · ${open.length} open` : ""}`}
        actions={
          <Button size="sm" onClick={() => setInviting(true)} data-testid="invite-user">
            <Send size={14} /> Invite user
          </Button>
        }
      >
        {invitations.length === 0 ? (
          <EmptyState title="No open invitations" description="Invite a colleague: they'll receive a link to set their password and connect their email and WhatsApp." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invitee</Th>
                <Th>Status</Th>
                <Th>Invited</Th>
                <Th>Expires</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invitations.map((i) => {
                const s = STATUS[i.status];
                return (
                  <tr key={i.id} className="hover:bg-gray-50/60" data-testid="invitation-row">
                    <Td className="max-w-[16rem]">
                      <div className="truncate font-medium text-gray-900">
                        {i.name ?? i.email} <Badge tone={ROLE_TONE[i.role as Role]}>{ROLE_SHORT_LABELS[i.role as Role]}</Badge>
                      </div>
                      {i.name && <div className="truncate text-xs text-gray-500">{i.email}</div>}
                    </Td>
                    <Td>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {i.status === "accepted" && i.acceptedUser
                          ? `Joined as ${i.acceptedUser.name} on ${formatDate(i.acceptedAt)}`
                          : i.sentAt
                            ? `Emailed via ${VIA[i.sentVia ?? ""] ?? "system mailbox"} ${formatDateTime(i.sentAt)}`
                            : i.sendError
                              ? "Not emailed — share the link by hand"
                              : "Not emailed"}
                      </div>
                    </Td>
                    <Td className="text-xs text-gray-600">
                      {i.invitedBy}
                      <div className="text-gray-400">{formatDate(i.createdAt)}</div>
                    </Td>
                    <Td className="text-xs text-gray-600">{i.status === "pending" ? formatDate(i.expiresAt) : "—"}</Td>
                    <Td className="text-right">
                      {i.status !== "accepted" && (
                        <div className="flex justify-end gap-1">
                          {i.inviteUrl && (
                            <>
                              <CopyButton text={i.inviteUrl} />
                              <a
                                href={whatsappUrl(chatTextFor(i, firmName), i.phone)}
                                target="_blank"
                                rel="noreferrer"
                                title="Send the link on WhatsApp"
                                className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                              >
                                <MessageCircle size={13} className="text-emerald-600" /> WhatsApp
                              </a>
                            </>
                          )}
                          <Button size="sm" variant="ghost" loading={busy === i.id} onClick={() => resend(i)}>
                            Resend
                          </Button>
                          {i.status !== "revoked" && (
                            <Button size="sm" variant="ghost" loading={busy === i.id} onClick={() => revoke(i)}>
                              Withdraw
                            </Button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {inviting && <InviteModal firmName={firmName} onClose={() => setInviting(false)} onDone={() => router.refresh()} />}
      {resent && (
        <Modal open onClose={() => setResent(null)} title="Invitation resent" footer={<Button onClick={() => setResent(null)}>Done</Button>}>
          <ResultPanel r={resent} firmName={firmName} />
        </Modal>
      )}
    </>
  );
}
