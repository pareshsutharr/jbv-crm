"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { api } from "@/lib/api-client";

type Invitation = { email: string; name: string | null; designation: string | null; phone: string | null; role: string; invitedBy: string };

export function AcceptForm({ token, invitation, firmName, signedInAs }: { token: string; invitation: Invitation; firmName: string; signedInAs: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    if (password !== String(f.get("confirm") ?? "")) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api("/api/invite/accept", "POST", { token, name: f.get("name"), designation: f.get("designation"), whatsapp: f.get("whatsapp"), password });
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
      return;
    }
    // Sign the new user in straight away and continue to the onboarding checklist.
    const res = await signIn("credentials", { email: invitation.email, password, redirect: false });
    if (!res || res.error) {
      router.push("/login?registered=invited");
      return;
    }
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="accept-invite">
      <div>
        <h1 className="text-base font-semibold">Join {firmName}</h1>
        <p className="text-sm text-gray-500">
          {invitation.invitedBy} invited you as <b>{invitation.role}</b>. Set a password for <b>{invitation.email}</b> to get started.
        </p>
      </div>
      {signedInAs && signedInAs !== invitation.email && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">You&apos;re currently signed in as {signedInAs}. Accepting will sign you in as the new account.</p>
      )}
      <ErrorText>{error}</ErrorText>
      <Field label="Full name" htmlFor="name">
        <Input id="name" name="name" defaultValue={invitation.name ?? ""} required autoFocus />
      </Field>
      <Field label="Designation" htmlFor="designation" hint="e.g. Relationship Manager — shown in your email and WhatsApp signatures.">
        <Input id="designation" name="designation" defaultValue={invitation.designation ?? ""} />
      </Field>
      <Field label="WhatsApp number" htmlFor="whatsapp" hint="Optional now; you can add it in the next step. With country code, e.g. +91 98200 12345.">
        <Input id="whatsapp" name="whatsapp" defaultValue={invitation.phone ?? ""} placeholder="+91 " />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Button type="submit" className="w-full" loading={loading}>
        Create my account
      </Button>
    </form>
  );
}
