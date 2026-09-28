import { NextResponse } from "next/server";
import { syncAllMailboxes } from "@/lib/email-sync";

/** Scheduled mailbox sync for all users (e.g. every 15 minutes). `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, results: await syncAllMailboxes() });
}

/** Vercel Cron (and other schedulers that can only GET) — same secret, same job. */
export const GET = POST;
