"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api-client";

export function IntegrationActions({ provider, connected, configured, returnTo }: { provider: "GOOGLE" | "MICROSOFT"; connected: boolean; configured: boolean; returnTo?: "onboarding" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const slug = provider.toLowerCase();

  async function sync() {
    setBusy("sync");
    setResult(null);
    try {
      const { results } = await api<{ results: { provider: string; stored?: number; fetched?: number; error?: string }[] }>("/api/integrations/sync", "POST");
      const r = results.find((x) => x.provider === provider);
      setResult(r?.error ? `Sync failed: ${r.error}` : `Checked ${r?.fetched ?? 0} messages, ${r?.stored ?? 0} matched a lead or client.`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect this account?")) return;
    setBusy("disconnect");
    await api(`/api/integrations/${slug}`, "DELETE");
    setBusy(null);
    router.refresh();
  }

  if (!connected) {
    return configured ? (
      <a href={`/api/integrations/${slug}/connect${returnTo ? `?return=${returnTo}` : ""}`} className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
        Connect
      </a>
    ) : (
      <span className="max-w-[12rem] text-right text-xs text-gray-400">Not set up on this server yet (admin: add OAuth credentials)</span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={busy === "sync"} onClick={sync}>
          Sync emails now
        </Button>
        <Button size="sm" variant="ghost" loading={busy === "disconnect"} onClick={disconnect}>
          Disconnect
        </Button>
      </div>
      {result && (
        <p className="text-xs text-gray-500" data-testid="sync-result">
          {result}
        </p>
      )}
    </div>
  );
}
