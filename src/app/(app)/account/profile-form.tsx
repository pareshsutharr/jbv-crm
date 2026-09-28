"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { api } from "@/lib/api-client";

export type ProfileFieldName = "name" | "designation" | "phone" | "whatsapp" | "meetingLink" | "callMeBotKey" | "whatsappAlerts";
export type ProfileValues = Partial<Record<ProfileFieldName, string | boolean | null>>;

const META: Record<ProfileFieldName, { label: string; hint?: string; placeholder?: string; type?: string; required?: boolean; wide?: boolean }> = {
  name: { label: "Full name", required: true },
  designation: { label: "Designation", placeholder: "e.g. Relationship Manager", hint: "Shown in your email and WhatsApp signatures." },
  phone: { label: "Phone", placeholder: "+91 …" },
  whatsapp: {
    label: "WhatsApp number",
    placeholder: "+91 98200 12345",
    hint: "With country code. Meeting details you share open in your own WhatsApp, and this number goes in your signature so people can reply.",
  },
  meetingLink: {
    label: "Personal meeting link",
    type: "url",
    placeholder: "https://zoom.us/j/… or https://meet.google.com/…",
    hint: "Optional. Prefilled when you schedule a meeting without a connected calendar.",
    wide: true,
  },
  whatsappAlerts: { label: "WhatsApp me about new website enquiries (assigned to me, or all if I'm an admin)", type: "checkbox", wide: true },
  callMeBotKey: {
    label: "CallMeBot API key (fallback for alerts)",
    placeholder: "123456",
    hint: "Used only when the firm's WhatsApp isn't linked. Get a key once by sending “I allow callmebot to send me messages” to CallMeBot on WhatsApp — see callmebot.com/blog/free-api-whatsapp-messages.",
    wide: true,
  },
};

/** Self-service profile fields; only the fields shown are sent, so steps can save independently. */
export function ProfileForm({ initial, fields, submitLabel = "Save", onSaved, id }: { initial: ProfileValues; fields: ProfileFieldName[]; submitLabel?: string; onSaved?: () => void; id?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    const f = new FormData(e.currentTarget);
    const body: Record<string, string | boolean> = {};
    for (const k of fields) body[k] = META[k].type === "checkbox" ? f.get(k) === "on" : String(f.get(k) ?? "").trim();
    try {
      await api("/api/account", "PATCH", body);
      setSaved(true);
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id={id} onSubmit={onSubmit} className="grid gap-4 px-5 py-5 sm:grid-cols-2" data-testid={id ?? "profile-form"}>
      <div className="sm:col-span-2">
        <ErrorText>{error}</ErrorText>
        {saved && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}
      </div>
      {fields.map((k) => {
        const m = META[k];
        if (m.type === "checkbox") {
          return (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input id={`pf-${k}`} name={k} type="checkbox" defaultChecked={initial[k] !== false && initial[k] !== null} className="rounded border-gray-300" /> {m.label}
            </label>
          );
        }
        return (
          <div key={k} className={m.wide || fields.length === 1 ? "sm:col-span-2" : undefined}>
            <Field label={m.label} htmlFor={`pf-${k}`} hint={m.hint}>
              <Input id={`pf-${k}`} name={k} type={m.type ?? "text"} defaultValue={typeof initial[k] === "string" ? initial[k] : ""} placeholder={m.placeholder} required={m.required} />
            </Field>
          </div>
        );
      })}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
