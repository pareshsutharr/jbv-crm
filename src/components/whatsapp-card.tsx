"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/layout";
import { Badge, Button, ErrorText, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatWhatsApp, whatsappUrl } from "@/lib/whatsapp";

type Contact = { name: string; phone: string | null };
type Parent = { leadId?: string; clientId?: string };

type Firm = { linked: boolean; phone: string | null; available: boolean };

/** Message a lead / client on WhatsApp: from the firm's linked WhatsApp when available, else via the user's phone. Logged either way. */
export function WhatsAppCard({ parent, contacts, firm, canSend, isAdmin = false }: { parent: Parent; contacts: Contact[]; firm: Firm; canSend: boolean; isAdmin?: boolean }) {
  const linked = firm.linked;
  const router = useRouter();
  const withPhone = contacts.filter((c) => c.phone);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(withPhone.length === 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = String(f.get("text") ?? "").trim();
    const chosen = withPhone.find((c) => c.phone === f.get("contact"));
    const phone = custom ? String(f.get("phone") ?? "").trim() : (chosen?.phone ?? "");
    const name = custom ? String(f.get("name") ?? "").trim() || null : (chosen?.name ?? null);
    if (!phone || !text) return;
    setLoading(true);
    setError(null);
    // Not linked: open WhatsApp synchronously (popup blockers) and just record it.
    if (!linked) window.open(whatsappUrl(text, phone), "_blank", "noopener");
    try {
      const r = await api<{ direct: boolean; queued?: boolean; to: string }>("/api/whatsapp/send", "POST", { ...parent, phone, name, text });
      setResult(r.direct ? (r.queued ? `Queued on the firm's WhatsApp for ${name ?? r.to}; it goes out in a moment.` : `Sent to ${name ?? r.to} on WhatsApp from the CRM.`) : `Opened in your WhatsApp for ${name ?? r.to}; logged on the timeline.`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      title="WhatsApp"
      actions={
        canSend && (
          <Button size="sm" onClick={() => (setOpen((v) => !v), setResult(null))} data-testid="whatsapp-message">
            <MessageCircle size={14} /> Message
          </Button>
        )
      }
    >
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="flex flex-wrap items-center gap-2 text-gray-600">
          {linked ? <Badge tone="green">Firm WhatsApp linked</Badge> : <Badge>Not linked</Badge>}
          {linked ? (
            `Messages go out from the firm's WhatsApp${firm.phone ? ` ${formatWhatsApp(firm.phone)}` : ""}, signed with your name.`
          ) : firm.available ? (
            <>
              Messages open in your WhatsApp app.{" "}
              {isAdmin ? (
                <Link href="/settings" className="font-medium text-brand-600 hover:underline">
                  Link the firm&apos;s WhatsApp
                </Link>
              ) : (
                "An administrator can link the firm's WhatsApp under Settings"
              )}{" "}
              so they are sent from the CRM.
            </>
          ) : (
            "Messages open in your WhatsApp app with the text prefilled."
          )}
        </p>
        {withPhone.length > 0 && <p className="text-xs text-gray-500">Contacts: {withPhone.map((c) => `${c.name} ${formatWhatsApp(c.phone)}`).join(" · ")}</p>}
        {result && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800" data-testid="whatsapp-result">{result}</p>}
        {open && canSend && (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3" data-testid="whatsapp-form">
            <ErrorText>{error}</ErrorText>
            {!custom && withPhone.length > 0 ? (
              <Field label="To" htmlFor="wa-contact">
                <Select id="wa-contact" name="contact" options={withPhone.map((c) => ({ value: c.phone!, label: `${c.name} · ${formatWhatsApp(c.phone)}` }))} />
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name" htmlFor="wa-name">
                  <Input id="wa-name" name="name" />
                </Field>
                <Field label="WhatsApp number" htmlFor="wa-phone">
                  <Input id="wa-phone" name="phone" placeholder="+91 " required />
                </Field>
              </div>
            )}
            {withPhone.length > 0 && (
              <button type="button" className="text-xs text-gray-500 hover:text-gray-900" onClick={() => setCustom((v) => !v)}>
                {custom ? "Choose a contact instead" : "Send to another number"}
              </button>
            )}
            <Field label="Message" htmlFor="wa-text">
              <Textarea id="wa-text" name="text" rows={3} required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button type="submit" size="sm" loading={loading}>
                <MessageCircle size={13} /> {linked ? "Send from CRM" : "Open in WhatsApp"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
