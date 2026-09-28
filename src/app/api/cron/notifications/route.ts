import { NextResponse } from "next/server";
import { syncAllNotifications } from "@/lib/notifications";

/**
 * Generates task-due and IPO-closing reminders for every active user.
 * Call from a scheduler (e.g. hourly) with `Authorization: Bearer $CRON_SECRET`.
 * Reminders are also generated for the signed-in user on each page load.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await syncAllNotifications();
  return NextResponse.json({ ok: true, users });
}

/** Vercel Cron (and other schedulers that can only GET) — same secret, same job. */
export const GET = POST;
