import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { as } from "./helpers";

// The website form key the server was started with (from .env unless set in the environment).
const WEBSITE_KEY = process.env.WEBSITE_API_KEY ?? /WEBSITE_API_KEY="?([^"\n]*)"?/.exec(readFileSync(".env", "utf8"))?.[1] ?? "";

// Runs against the provider mock (e2e/mocks/provider-mock.mjs): HTTP on 4455, SMTP on 1026.
const MOCK = "http://localhost:4455";
type SmtpMessage = { from: string | null; to: string[]; raw: string };
const smtpLog = async (page: Page) => (await (await page.request.get(`${MOCK}/__smtp`)).json()) as SmtpMessage[];
/** Undo RFC 5322 folding and quoted-printable so the calendar text can be asserted on. */
const unfold = (raw: string) => raw.replace(/\r\n[ \t]/g, "").replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const FIRM_SMTP = { host: "localhost", port: 1026, user: "admin@beipoready.com", pass: "firm-password", from: "admin@beipoready.com", secure: false };

async function clientId(page: Page, q: string) {
  return ((await (await page.request.get(`/api/clients?q=${encodeURIComponent(q)}`)).json()).clients[0] as { id: string }).id;
}

test.describe.configure({ mode: "serial" });

test("everyone sends from the firm mailbox: an RM's meeting invitation goes out 'via Be IPO Ready' with Reply-To, and so does the cancellation", async ({ browser }) => {
  const admin = await as(browser, "admin");
  await admin.request.delete("/api/integrations/google");
  expect((await admin.request.patch("/api/settings/system-email", { data: { smtp: FIRM_SMTP } })).status()).toBe(200);

  const rm = await as(browser, "rm1");
  // Self-contained: no calendar of their own, so the firm mailbox emails the invitation.
  await rm.request.delete("/api/integrations/google");
  await rm.request.delete("/api/integrations/microsoft");
  await rm.request.post(`${MOCK}/__reset`);
  const id = await clientId(rm, "Sahyadri");
  await rm.goto(`/clients/${id}`);
  await rm.getByRole("button", { name: "+ Schedule" }).click();
  await rm.fill("#mt-title", "Valuation kickoff");
  await expect(rm.locator("#mt-provider")).toHaveValue("ZOOM");
  await rm.fill("#mt-link", "https://zoom.us/j/555");
  await expect(rm.getByText("Email invitations from the firm mailbox as me (calendar file attached)")).toBeVisible();
  await rm.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(rm.getByTestId("meeting-scheduled")).toContainText("Calendar invite emailed");
  await rm.getByRole("button", { name: "Done" }).click();
  const row = rm.getByTestId("meeting-row").filter({ hasText: "Valuation kickoff" });
  await expect(row).toContainText("invite sent");

  const [invite] = await smtpLog(rm);
  expect(invite.from).toBe("admin@beipoready.com");
  expect(invite.to).toEqual(["suresh@sahyadrirenewables.in"]);
  const text = unfold(invite.raw);
  expect(text).toContain("From: Rohan Sharma via Be IPO Ready <admin@beipoready.com>");
  expect(text).toContain("Reply-To: rohan@beipoready.com");
  expect(text).toContain("text/calendar");
  expect(text).toContain("METHOD:REQUEST");
  expect(text).toContain("SUMMARY:Valuation kickoff");
  expect(text).toContain("mailto:suresh@sahyadrirenewables.in");
  expect(text).toContain("https://zoom.us/j/555");
  expect(text).toContain("Rohan Sharma, Relationship Manager");
  // …and it sits on the client's email timeline as sent by the RM.
  await expect(rm.getByTestId("email-threads")).toContainText("Meeting: Valuation kickoff");

  // The Share menu's "Email invite" uses the same firm mailbox.
  await row.getByTestId("share-menu").click();
  await row.getByTestId("share-email").click();
  await expect(row.getByTestId("share-result")).toContainText("Emailed to suresh@sahyadrirenewables.in from admin@beipoready.com");

  await row.getByRole("button", { name: "Cancel" }).click();
  await rm.fill("#cm-text", "Client asked to move it");
  await rm.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(rm.getByTestId("meeting-row").filter({ hasText: "Valuation kickoff" })).toContainText("Cancelled");
  const after = await smtpLog(rm);
  expect(after).toHaveLength(3);
  expect(unfold(after[2].raw)).toContain("Subject: Cancelled: Valuation kickoff");
  expect(unfold(after[2].raw)).toContain("METHOD:CANCEL");
  expect(unfold(after[2].raw)).toContain("Reply-To: rohan@beipoready.com");
  await admin.request.patch("/api/settings/system-email", { data: { smtp: null } });
});

test("firm WhatsApp: the admin links it by QR through the WhatsApp service; everyone then sends from it; staff get enquiry alerts; unlinking falls back to wa.me", async ({ browser }) => {
  const admin = await as(browser, "admin");
  await admin.request.post(`${MOCK}/__wa/reset`);
  await admin.request.post(`${MOCK}/__reset`);

  // Not linked yet: users get the wa.me fallback and only admins may link.
  const rm = await as(browser, "rm1");
  expect((await rm.request.post("/api/whatsapp")).status()).toBe(403);
  const id = await clientId(rm, "Sahyadri");
  await rm.goto(`/clients/${id}`);
  await expect(rm.getByText("An administrator can link the firm's WhatsApp under Settings")).toBeVisible();

  // Admin links: QR from the service, then "Linked" once the (mock) phone scans it.
  await admin.goto("/settings");
  const link = admin.getByTestId("whatsapp-link");
  await expect(link).toContainText("Not linked");
  await admin.getByTestId("link-whatsapp").click();
  await expect(admin.getByTestId("whatsapp-qr")).toBeVisible();
  await expect(link).toContainText("Linked", { timeout: 20_000 });
  await expect(link).toContainText("+91 99999 00000");

  // An RM messages a client: it goes out from the firm's number and is logged with the RM's name.
  await rm.goto(`/clients/${id}`);
  await expect(rm.getByText("Messages go out from the firm's WhatsApp +91 99999 00000")).toBeVisible();
  await rm.getByTestId("whatsapp-message").click();
  await rm.selectOption("#wa-contact", { label: "Suresh Patil · +91 98250 55001" });
  await rm.fill("#wa-text", "Sharing the valuation timeline shortly.");
  await rm.getByRole("button", { name: "Send from CRM" }).click();
  await expect(rm.getByTestId("whatsapp-result")).toContainText("Sent to Suresh Patil on WhatsApp from the CRM");
  await expect(rm.getByTestId("timeline")).toContainText("sent from the firm's WhatsApp by Rohan Sharma");
  const sent = (await (await rm.request.get(`${MOCK}/__wa`)).json()) as { phone: string; text: string }[];
  expect(sent).toEqual([{ phone: "+919825055001", text: "Sharing the valuation timeline shortly." }]);

  // Meeting details go the same way.
  await rm.request.post(`${MOCK}/__reset`);
  const created = await rm.request.post("/api/meetings", {
    data: { clientId: id, title: "Site visit", startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMin: 60, provider: "IN_PERSON", location: "Pune plant", attendees: [{ name: "Suresh Patil", email: "suresh@sahyadrirenewables.in", phone: "+91 98250 55001" }], addToCalendar: false },
  });
  const { meeting } = (await created.json()) as { meeting: { id: string } };
  const share = await rm.request.post(`/api/meetings/${meeting.id}/share`, { data: { channel: "whatsapp", phone: "+91 98250 55001", name: "Suresh Patil" } });
  expect((await share.json()).direct).toBe(true);
  const shared = (await (await rm.request.get(`${MOCK}/__wa`)).json()) as { phone: string; text: string }[];
  expect(shared[0].phone).toBe("+919825055001");
  expect(shared[0].text).toContain("Meeting: Site visit");
  expect(shared[0].text).toContain("Where: Pune plant");
  expect(shared[0].text).toContain("Rohan Sharma");

  // A new website enquiry alerts admins (and the assigned RM) on WhatsApp.
  expect((await admin.request.patch("/api/account", { data: { whatsapp: "+91 98200 00001", whatsappAlerts: true } })).status()).toBe(200);
  await admin.request.post(`${MOCK}/__reset`);
  // Unique contact details: repeat submissions are merged rather than created.
  const stamp = Date.now().toString().slice(-9);
  const lead = await admin.request.post("/api/public/leads", {
    headers: { "X-Api-Key": WEBSITE_KEY },
    data: { type: "enquiry", companyName: "Alert Check Pvt Ltd", name: "Alert Check", email: `alert-${stamp}@example.com`, phone: `+91 9${stamp}`, message: "Testing alerts" },
  });
  expect(lead.status()).toBe(201);
  const alerts = (await (await admin.request.get(`${MOCK}/__wa`)).json()) as { phone: string; text: string }[];
  const mine = alerts.find((m) => m.phone === "+919820000001")!;
  expect(mine).toBeTruthy();
  expect(mine.text).toContain("New enquiry");
  expect(mine.text).toContain("Alert Check Pvt Ltd");
  expect(mine.text).toContain("/leads/");

  // Unlink → back to the wa.me fallback for everyone.
  await admin.goto("/settings");
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Unlink" }).click();
  await expect(admin.getByTestId("whatsapp-link")).toContainText("Not linked");
  await rm.goto(`/clients/${id}`);
  await expect(rm.getByText("An administrator can link the firm's WhatsApp under Settings")).toBeVisible();

  // Onboarding is a single step; nothing for users to connect.
  await rm.goto("/onboarding");
  await expect(rm.getByTestId("onboarding-step-1")).toContainText("Your details");
  await expect(rm.getByTestId("onboarding-step-3")).toHaveCount(0);
  await admin.request.patch("/api/account", { data: { whatsapp: "" } });
});
