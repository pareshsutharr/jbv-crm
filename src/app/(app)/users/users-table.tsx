"use client";

import type { Role } from "@prisma/client";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState, Table, Td, Th } from "@/components/layout";
import { Badge, Button, ErrorText, Field, Input, Modal, Select } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { options, ROLE_LABELS, ROLE_SHORT_LABELS, ROLE_TONE } from "@/lib/labels";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  designation: string | null;
  whatsapp: string | null;
  onboardedAt: string | null;
  connectedAccounts: { provider: "GOOGLE" | "MICROSOFT" | "SMTP"; email: string }[];
  lastLoginAt: string | null;
  createdAt: string;
  book: { leads: number; clients: number } | null;
};

const MAILBOX: Record<"GOOGLE" | "MICROSOFT" | "SMTP", string> = { GOOGLE: "Gmail", MICROSOFT: "Outlook", SMTP: "Email" };

const roleOptions = options(ROLE_LABELS);

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [reassigning, setReassigning] = useState<UserRow | null>(null);
  const activeRms = users.filter((u) => u.role === "RM" && u.active);

  async function toggleActive(u: UserRow) {
    if (u.active && u.book && u.book.leads + u.book.clients > 0) {
      const ok = confirm(`${u.name} still has ${u.book.leads} open leads and ${u.book.clients} clients. Deactivate anyway? (Use "Reassign book" to hand them over first.)`);
      if (!ok) return;
    }
    try {
      await send(`/api/users/${u.id}`, "PATCH", { active: !u.active });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <Card
        title="Team members"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New user
          </Button>
        }
      >
        {users.length === 0 ? (
          <EmptyState title="No users yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Setup</Th>
                <Th>Book</Th>
                <Th>Last login</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/60">
                  <Td className="max-w-[14rem] truncate">
                    <div className="font-medium text-gray-900">
                      {u.name} {u.id === currentUserId && <span className="text-xs font-normal text-gray-400">(you)</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {u.email}
                      {u.designation && <span className="text-gray-400"> · {u.designation}</span>}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_TONE[u.role]}>{ROLE_SHORT_LABELS[u.role]}</Badge>
                  </Td>
                  <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Inactive</Badge>}</Td>
                  <Td className="text-xs text-gray-600">
                    <div className="flex flex-col gap-0.5" title="Optional Google / Microsoft connection (Meet & Teams links); everyone sends email and WhatsApp from the firm's shared channels">
                      <span className={u.connectedAccounts.length ? "text-emerald-700" : "text-gray-400"}>
                        {u.connectedAccounts.length ? `✓ ${u.connectedAccounts.map((a) => MAILBOX[a.provider]).join(", ")}` : "Firm mailbox"}
                      </span>
                      <span className={u.whatsapp ? "text-emerald-700" : "text-gray-400"}>{u.whatsapp ? "✓ WhatsApp no. in signature" : "– No WhatsApp no."}</span>
                      {u.active && !u.onboardedAt && <span className="text-amber-700">Onboarding pending</span>}
                    </div>
                  </Td>
                  <Td className="text-xs text-gray-600">{u.book ? `${u.book.leads} leads · ${u.book.clients} clients` : "—"}</Td>
                  <Td>
                    {formatDateTime(u.lastLoginAt)}
                    <div className="text-xs text-gray-400">Joined {formatDate(u.createdAt)}</div>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {u.book && u.book.leads + u.book.clients > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => setReassigning(u)}>
                          Reassign book
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                      {u.id !== currentUserId && (
                        <Button size="sm" variant={u.active ? "ghost" : "secondary"} onClick={() => toggleActive(u)}>
                          {u.active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {reassigning && (
        <ReassignModal from={reassigning} targets={activeRms.filter((r) => r.id !== reassigning.id)} onClose={() => setReassigning(null)} onDone={() => router.refresh()} />
      )}
      <CreateUserModal open={creating} onClose={() => setCreating(false)} onDone={() => router.refresh()} />
      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onDone={() => router.refresh()}
        />
      )}
    </>
  );
}

function CreateUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await send("/api/users", "POST", Object.fromEntries(new FormData(e.currentTarget)));
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New user"
      description="Creates the account with a password you share yourself. Prefer “Invite user” above so they set their own password and are walked through onboarding."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-user" loading={loading}>
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user" onSubmit={onSubmit} className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Field label="Full name" htmlFor="cu-name">
          <Input id="cu-name" name="name" required />
        </Field>
        <Field label="Email" htmlFor="cu-email">
          <Input id="cu-email" name="email" type="email" required />
        </Field>
        <Field label="Role" htmlFor="cu-role">
          <Select id="cu-role" name="role" options={roleOptions} defaultValue="RM" />
        </Field>
        <Field label="Temporary password" htmlFor="cu-password" hint="At least 8 characters. Share it securely.">
          <Input id="cu-password" name="password" type="text" minLength={8} required />
        </Field>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, isSelf, onClose, onDone }: { user: UserRow; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: form.get("name") };
    if (!isSelf) body.role = form.get("role");
    const password = String(form.get("password") ?? "");
    if (password) body.password = password;
    try {
      await send(`/api/users/${user.id}`, "PATCH", body);
      onDone();
      onClose();
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
      title={`Edit ${user.name}`}
      description={user.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-user" loading={loading}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-user" onSubmit={onSubmit} className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Field label="Full name" htmlFor="eu-name">
          <Input id="eu-name" name="name" defaultValue={user.name} required />
        </Field>
        <Field label="Role" htmlFor="eu-role" hint={isSelf ? "You cannot change your own role." : undefined}>
          <Select id="eu-role" name="role" options={roleOptions} defaultValue={user.role} disabled={isSelf} />
        </Field>
        <Field label="Reset password" htmlFor="eu-password" hint="Leave blank to keep the current password.">
          <Input id="eu-password" name="password" type="text" minLength={8} />
        </Field>
      </form>
    </Modal>
  );
}

function ReassignModal({ from, targets, onClose, onDone }: { from: UserRow; targets: UserRow[]; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const r = await send("/api/admin/reassign", "POST", {
        fromRmId: from.id,
        toRmId: f.get("toRmId"),
        leads: f.get("leads") === "on",
        clients: f.get("clients") === "on",
        tasks: f.get("tasks") === "on",
      });
      setResult(`Moved ${r.leads} leads, ${r.clients} clients and ${r.tasks} open tasks.`);
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
      title={`Reassign ${from.name}'s book`}
      description="Hands leads and clients to another RM. Interaction history stays with each record; every move is logged."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="reassign-form" loading={loading} disabled={targets.length === 0}>
              Reassign
            </Button>
          </>
        )
      }
    >
      {result ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="reassign-result">
          {result}
        </p>
      ) : (
        <form id="reassign-form" onSubmit={onSubmit} className="space-y-3">
          <ErrorText>{error}</ErrorText>
          <Field label="Reassign to" htmlFor="ra-to">
            <Select id="ra-to" name="toRmId" options={targets.map((t) => ({ value: t.id, label: t.name }))} required />
          </Field>
          <fieldset className="space-y-2 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="leads" defaultChecked className="rounded border-gray-300" /> Open leads ({from.book?.leads ?? 0})
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="clients" defaultChecked className="rounded border-gray-300" /> Clients ({from.book?.clients ?? 0}), with their originating leads
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="tasks" defaultChecked className="rounded border-gray-300" /> Open follow-up tasks on those records
            </label>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
