/**
 * WhatsApp alerts to staff (e.g. a new website enquiry). Tries the firm's
 * linked WhatsApp first and CallMeBot second (only for staff who registered a
 * CallMeBot key). Channels are independent: one failing never blocks another.
 */
import { sendCallMeBot } from "@/lib/callmebot";
import { appUrl } from "@/lib/integrations/config";
import { LEAD_SOURCE_LABELS, SERVICE_LABELS } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { firmWhatsappLinked, sendFirmWhatsAppText } from "@/lib/whatsapp-client";

export type StaffRecipient = { id: string; name: string; whatsapp: string | null; callMeBotKey: string | null };
export type AlertOutcome = { userId: string; via: "whatsapp" | "callmebot" | "skipped"; error?: string };

export async function alertStaffOnWhatsApp(recipients: StaffRecipient[], text: string): Promise<AlertOutcome[]> {
  const targets = recipients.filter((r) => r.whatsapp);
  if (!targets.length) return [];
  const linked = await firmWhatsappLinked();
  const results = await Promise.allSettled(
    targets.map(async (r): Promise<AlertOutcome> => {
      if (linked) {
        try {
          await sendFirmWhatsAppText(r.whatsapp!, text);
          return { userId: r.id, via: "whatsapp" };
        } catch (err) {
          if (!r.callMeBotKey) return { userId: r.id, via: "whatsapp", error: (err as Error).message };
        }
      }
      if (r.callMeBotKey) {
        try {
          await sendCallMeBot(r.whatsapp!, r.callMeBotKey, text);
          return { userId: r.id, via: "callmebot" };
        } catch (err) {
          return { userId: r.id, via: "callmebot", error: (err as Error).message };
        }
      }
      return { userId: r.id, via: "skipped" };
    }),
  );
  return results.map((r, i) => (r.status === "fulfilled" ? r.value : { userId: targets[i].id, via: "skipped", error: String(r.reason) }));
}

/** New website enquiry → the assigned RM and every administrator who opted in. */
export async function alertNewWebsiteLead(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { assignedRm: { select: { id: true, name: true, whatsapp: true, callMeBotKey: true, whatsappAlerts: true } } } });
  if (!lead) return [];
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true, whatsappAlerts: true, whatsapp: { not: null } }, select: { id: true, name: true, whatsapp: true, callMeBotKey: true } });
  const recipients = new Map<string, StaffRecipient>();
  if (lead.assignedRm?.whatsappAlerts) recipients.set(lead.assignedRm.id, lead.assignedRm);
  for (const a of admins) recipients.set(a.id, a);
  const text = [
    `New enquiry (${LEAD_SOURCE_LABELS[lead.source]}): ${lead.companyName}`,
    `${lead.name}${lead.designation ? `, ${lead.designation}` : ""} · ${lead.phone}${lead.email ? ` · ${lead.email}` : ""}`,
    [lead.serviceInterest ? SERVICE_LABELS[lead.serviceInterest] : null, lead.city, lead.revenueCr != null ? `₹${Number(lead.revenueCr)} Cr revenue` : null].filter(Boolean).join(" · ") || null,
    lead.assignedRm ? `Assigned to ${lead.assignedRm.name}` : "Unassigned",
    `${appUrl()}/leads/${lead.id}`,
  ]
    .filter(Boolean)
    .join("\n");
  const outcomes = await alertStaffOnWhatsApp([...recipients.values()], text);
  if (outcomes.some((o) => o.error)) console.warn("Staff WhatsApp alert problems:", outcomes.filter((o) => o.error));
  return outcomes;
}
