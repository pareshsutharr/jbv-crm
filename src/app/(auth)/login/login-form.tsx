"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";

const ERRORS: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  AccountInactive: "Your account is awaiting activation by an administrator.",
};

export function LoginForm({ registered }: { registered?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });
    setLoading(false);
    if (!res || res.error) {
      setError(ERRORS[res?.error ?? ""] ?? "Could not sign in.");
      return;
    }
    const callbackUrl = params.get("callbackUrl");
    // Only follow same-origin relative callback URLs.
    router.push(callbackUrl?.startsWith("/") ? callbackUrl : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-base font-semibold">Sign in</h1>
        <p className="text-sm text-gray-500">Welcome back to the Be IPO Ready CRM.</p>
      </div>
      {registered === "pending" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Account created. An administrator must activate it before you can sign in.
        </p>
      )}
      {registered === "invited" && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Your account is ready. Sign in with the password you just set.</p>
      )}
      {registered === "admin" && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Admin account created. Sign in to continue.</p>
      )}
      <ErrorText>{error}</ErrorText>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={loading}>
        Sign in
      </Button>
      <p className="text-center text-xs text-gray-500">
        No account?{" "}
        <Link href="/signup" className="font-medium text-brand-600 hover:underline">
          Request access
        </Link>
      </p>
    </form>
  );
}
