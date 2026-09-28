import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { alertNewWebsiteLead } from "@/lib/staff-alerts";
import { allowedOrigin, ingestWebsiteLead, rateLimited, validApiKey, websiteLeadSchema } from "@/lib/website-leads";

export const maxDuration = 30; // staff WhatsApp alerts go out before answering

/**
 * Public endpoint for beipoready.com forms (no CRM session).
 * Auth: `Authorization: Bearer $WEBSITE_API_KEY` (or `x-api-key`).
 * Browsers on WEBSITE_ALLOWED_ORIGINS may call it directly (CORS).
 */
function cors(origin: string | null): Record<string, string> {
  const allowed = allowedOrigin(origin);
  return allowed
    ? { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key", Vary: "Origin" }
    : {};
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get("origin"));
  const key = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!validApiKey(key)) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401, headers });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });

  let input;
  try {
    input = websiteLeadSchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") : "Invalid JSON body";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
  // Honeypot filled → pretend success, store nothing.
  if (input.website) return NextResponse.json({ ok: true }, { status: 202, headers });

  const { lead, deduplicated } = await ingestWebsiteLead(input);
  // WhatsApp alert to the assigned RM and admins (firm WhatsApp, else CallMeBot). Never fails the request.
  if (!deduplicated) await Promise.race([alertNewWebsiteLead(lead.id), new Promise((r) => setTimeout(r, 20_000))]).catch((err) => console.warn("Lead alert failed:", err));
  return NextResponse.json({ ok: true, leadId: lead.id, deduplicated }, { status: deduplicated ? 200 : 201, headers });
}
