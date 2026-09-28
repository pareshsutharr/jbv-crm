/**
 * WhatsApp click-to-chat helpers (isomorphic — no server imports).
 *
 * The CRM never sends WhatsApp messages itself: a `wa.me` link opens the
 * user's own WhatsApp (app or web) with the message prefilled, so it goes
 * out from the number they registered, exactly like a personal chat.
 */

/** Digits only, with a country code. 10-digit numbers are assumed Indian (+91). */
export function normalisePhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** A link that opens WhatsApp with `text` prefilled. Without a number, WhatsApp asks whom to send it to. */
export function whatsappUrl(text: string, phone?: string | null) {
  return `https://wa.me/${normalisePhoneForWhatsApp(phone) ?? ""}?text=${encodeURIComponent(text)}`;
}

/** "+91 98200 12345" → "+91 98200 12345"; digits-only input is grouped for display. */
export function formatWhatsApp(phone: string | null | undefined) {
  const d = normalisePhoneForWhatsApp(phone);
  if (!d) return phone ?? "";
  if (d.startsWith("91") && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}
