import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// Runs against the provider mock (e2e/mocks/provider-mock.mjs) — see `npm run start:e2e`.
const MOCK = "http://localhost:4455";
type LogEntry = { method: string; path: string; auth: string | null; body: string };
const mockLog = async (page: Page) => (await (await page.request.get(`${MOCK}/__log`)).json()) as LogEntry[];

/** Connects the mocked Google account for the signed-in user unless it already is. */
async function ensureGoogle(page: Page) {
  await page.goto("/account");
  const google = page.getByTestId("integration-google");
  if (await google.getByRole("link", { name: "Connect" }).isVisible()) {
    await google.getByRole("link", { name: "Connect" }).click();
    await expect(page).toHaveURL(/\/account\?connected=google/);
  }
  await expect(google).toContainText("Connected");
}

/** Decodes the Gmail `raw` message the app posted to the mock (headers may be RFC 2047 encoded when non-ASCII). */
function decodeRaw(entry: LogEntry) {
  const raw = Buffer.from(JSON.parse(entry.body).raw, "base64url").toString("utf8");
  const [headers, body64] = raw.split("\r\n\r\n");
  const decodedHeaders = headers.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_, b64: string) => Buffer.from(b64, "base64").toString("utf8"));
  return { headers: decodedHeaders, body: Buffer.from(body64.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

test.describe.configure({ mode: "serial" });

test("admin invites a colleague: emailed from the system mailbox, accepted via the link, onboarding completed", async ({ browser }) => {
  const admin = await as(browser, "admin");
  // The seeded admin is the system sender; once Google is connected, invitations go out from that mailbox.
  await ensureGoogle(admin);
  await admin.goto("/settings");
  await expect(admin.getByTestId("system-email-summary")).toContainText("Sends from rohan@beipoready.com through Rakesh Doshi's connected Google");

  await admin.request.post(`${MOCK}/__reset`);
  await admin.goto("/users");
  await admin.getByTestId("invite-user").click();
  const email = `invitee-${Date.now()}@beipoready.com`;
  await admin.fill("#iv-email", email);
  await admin.fill("#iv-name", "Meera Iyer");
  await admin.selectOption("#iv-role", "RM");
  await admin.fill("#iv-designation", "Senior RM");
  await admin.fill("#iv-phone", "+91 98200 55555");
  await admin.getByRole("button", { name: "Send invitation" }).click();
  await expect(admin.getByTestId("invite-result")).toContainText(`Invitation emailed to ${email} via Gmail`);
  const link = (await admin.getByTestId("invite-link").textContent())!.trim();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  // WhatsApp share of the link is prefilled with the invitee's number and the link.
  const wa = admin.getByTestId("invite-result").getByRole("link", { name: /Send on WhatsApp/ });
  const waHref = (await wa.getAttribute("href"))!;
  expect(waHref).toMatch(/^https:\/\/wa\.me\/919820055555\?text=/);
  expect(decodeURIComponent(waHref)).toContain(link);

  // The email went through the mocked Gmail API with the link in the body.
  const send = (await mockLog(admin)).find((l) => l.method === "POST" && l.path.endsWith("/gmail/v1/users/me/messages/send"))!;
  expect(send).toBeTruthy();
  const mail = decodeRaw(send);
  expect(mail.headers).toContain(`To: ${email}`);
  expect(mail.headers).toContain("Subject: You're invited to the Be IPO Ready CRM");
  expect(mail.body).toContain("Rakesh Doshi, CEO has invited you to join the Be IPO Ready CRM as Relationship Manager");
  expect(mail.body).toContain(link);

  await admin.getByRole("button", { name: "Done" }).click();
  await expect(admin.getByTestId("invitation-row").filter({ hasText: email })).toContainText("Pending");

  // The invitee opens the link in a fresh browser, sets a password and lands on onboarding.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  const form = page.getByTestId("accept-invite");
  await expect(form).toContainText("Rakesh Doshi invited you as Relationship Manager");
  await expect(page.locator("#name")).toHaveValue("Meera Iyer");
  await expect(page.locator("#designation")).toHaveValue("Senior RM");
  await page.fill("#password", "Welcome@2026");
  await page.fill("#confirm", "Welcome@2026");
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByRole("heading", { name: "Welcome to Be IPO Ready, Meera" })).toBeVisible();
  await expect(page.getByTestId("onboarding-step-1")).toContainText("Done");
  // One step: details. The WhatsApp number came from the invitation; add a personal meeting link.
  await expect(page.locator("#pf-whatsapp")).toHaveValue("+91 98200 55555");
  await expect(page.getByTestId("onboarding-step-3")).toHaveCount(0);
  await page.fill("#pf-meetingLink", "https://zoom.us/j/1234567890");
  await page.getByTestId("onboarding-details").getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("onboarding-details")).toContainText("Saved.");
  expect((await (await page.request.patch("/api/account", { data: {} })).json()).user.meetingLink).toBe("https://zoom.us/j/1234567890");
  // Until finished, the app shows the reminder banner elsewhere…
  await page.goto("/leads");
  await expect(page.getByTestId("onboarding-banner")).toBeVisible();
  await page.goto("/onboarding");
  await page.getByTestId("finish-onboarding").click();
  await expect(page).toHaveURL("/");
  // …and not once the checklist is done.
  await expect(page.getByTestId("onboarding-banner")).toHaveCount(0);

  // The link is single-use.
  await page.goto(link);
  await expect(page.getByTestId("invite-problem")).toContainText("already been used");

  // Admin sees the new active RM with her channels set, and was notified.
  await admin.goto("/users");
  // Her name is also in the invitations table; the team-member row is the one with an Edit button.
  const row = admin.getByRole("row", { name: /Meera Iyer/ }).filter({ has: admin.getByRole("button", { name: "Edit" }) });
  await expect(row).toContainText("Active");
  await expect(row).toContainText("Senior RM");
  await expect(row).toContainText("✓ WhatsApp");
  await expect(admin.getByTestId("invitation-row").filter({ hasText: email })).toContainText("Accepted");
  await admin.goto("/notifications");
  await expect(admin.getByText("Meera Iyer accepted your invitation")).toBeVisible();
});

test("invitations: only admins; revoke stops the link; unknown tokens are rejected", async ({ browser }) => {
  const admin = await as(browser, "admin");
  const email = `revoke-${Date.now()}@beipoready.com`;
  const res = await admin.request.post("/api/invitations", { data: { email, role: "VIEWER" } });
  expect(res.status()).toBe(201);
  const { invitation, inviteUrl } = await res.json();
  const token = inviteUrl.split("/invite/")[1];
  expect((await admin.request.get(`/api/invite/${token}`)).status()).toBe(200);
  expect((await admin.request.delete(`/api/invitations/${invitation.id}`)).status()).toBe(200);
  expect((await admin.request.get(`/api/invite/${token}`)).status()).toBe(410);
  expect((await admin.request.get("/api/invite/not-a-real-token-at-all-1234")).status()).toBe(404);
  // Inviting an existing active user is refused.
  expect((await admin.request.post("/api/invitations", { data: { email: "rohan@beipoready.com", role: "RM" } })).status()).toBe(409);

  const rm = await as(browser, "rm1");
  expect((await rm.request.post("/api/invitations", { data: { email: "x@beipoready.com", role: "RM" } })).status()).toBe(403);
  expect((await rm.request.get("/api/invitations")).status()).toBe(403);
});

test("meeting details go out from the organiser's own mailbox and WhatsApp", async ({ browser }) => {
  const rm = await as(browser, "rm1");
  await ensureGoogle(rm);
  // The RM's own channels appear in the signature.
  expect((await rm.request.patch("/api/account", { data: { whatsapp: "+91 98111 22333", designation: "Relationship Manager" } })).status()).toBe(200);
  await rm.context().route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>wa.me mock</title>" }));

  const client = (await (await rm.request.get("/api/clients?q=Sahyadri")).json()).clients[0] as { id: string };
  await rm.request.post(`${MOCK}/__reset`);
  await rm.goto(`/clients/${client.id}`);
  await rm.getByRole("button", { name: "+ Schedule" }).click();
  await rm.fill("#mt-title", "DRHP walkthrough");
  // Suresh Patil is preselected; he has both an email and a WhatsApp number in the seed.
  await expect(rm.getByRole("checkbox", { name: /Suresh Patil/ })).toBeChecked();
  await rm.getByRole("button", { name: "Schedule", exact: true }).click();

  const done = rm.getByTestId("meeting-scheduled");
  await expect(done).toContainText("DRHP walkthrough");
  await expect(done).toContainText("Calendar invite emailed");

  // Email from the RM's connected Gmail, stored on the client's timeline.
  await done.getByTestId("share-email").click();
  await expect(done.getByTestId("share-result")).toContainText("Emailed to suresh@sahyadrirenewables.in from rohan@beipoready.com");
  const send = (await mockLog(rm)).find((l) => l.method === "POST" && l.path.endsWith("/gmail/v1/users/me/messages/send"))!;
  const mail = decodeRaw(send);
  expect(mail.headers).toContain("Subject: Meeting: DRHP walkthrough");
  expect(mail.body).toContain("Hi Suresh,");
  expect(mail.body).toContain("Join (Google Meet): https://meet.google.com/mock-abcd-efg");
  expect(mail.body).toContain("Rohan Sharma, Relationship Manager · Be IPO Ready");
  expect(mail.body).toContain("WhatsApp +91 98111 22333");

  // WhatsApp opens wa.me for the attendee's number with the same details prefilled.
  const [popup] = await Promise.all([rm.waitForEvent("popup"), done.getByTestId("share-whatsapp").first().click()]);
  await popup.waitForLoadState();
  const url = new URL(popup.url());
  expect(url.href).toMatch(/^https:\/\/wa\.me\/919825055001\?text=/);
  expect(url.searchParams.get("text")).toContain("Meeting: DRHP walkthrough");
  expect(url.searchParams.get("text")).toContain("https://meet.google.com/mock-abcd-efg");
  await popup.close();
  await rm.getByRole("button", { name: "Done" }).click();

  await expect(rm.getByTestId("email-threads")).toContainText("Meeting: DRHP walkthrough");
  await expect(rm.getByTestId("meeting-row").filter({ hasText: "DRHP walkthrough" }).getByTestId("share-menu")).toBeVisible();
});

test("admin enters SMTP under Settings; with no mailbox connected, invitations go out via SMTP from admin@beipoready.com", async ({ browser }) => {
  const admin = await as(browser, "admin");
  // Without a connected mailbox the system falls back to SMTP. Start from a clean slate.
  await admin.request.delete("/api/integrations/google");
  await admin.request.delete("/api/integrations/smtp");
  await admin.request.patch("/api/settings/system-email", { data: { smtp: null } });
  await admin.goto("/settings");
  await expect(admin.getByTestId("system-email-summary")).toContainText("Not set up yet");
  await admin.fill("#smtp-host", "localhost");
  await admin.fill("#smtp-port", "1026");
  await admin.fill("#smtp-user", "admin@beipoready.com");
  await admin.fill("#smtp-pass", "gmail-app-password");
  await admin.fill("#smtp-from", "admin@beipoready.com");
  await admin.getByRole("button", { name: "Save SMTP" }).click();
  await expect(admin.getByTestId("system-email-summary")).toContainText("Sends from admin@beipoready.com through SMTP (localhost)");
  await expect(admin.getByTestId("smtp-form")).toContainText("Configured");
  // The password is never sent back to the browser.
  const html = await admin.content();
  expect(html).not.toContain("gmail-app-password");

  await admin.request.post(`${MOCK}/__reset`);
  await admin.getByTestId("send-test-email").click();
  await expect(admin.getByTestId("system-email")).toContainText("Test email sent to you from admin@beipoready.com via SMTP");

  const email = `smtp-${Date.now()}@beipoready.com`;
  const res = await admin.request.post("/api/invitations", { data: { email, name: "Dev Patel", role: "VIEWER" } });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { sent: boolean; inviteUrl: string; invitation: { sentVia: string | null } };
  expect(body.sent).toBe(true);
  expect(body.invitation.sentVia).toBe("SMTP");

  const received = (await (await admin.request.get(`${MOCK}/__smtp`)).json()) as { from: string | null; to: string[]; raw: string }[];
  expect(received.map((m) => m.to[0])).toEqual(["admin@beipoready.com", email]);
  const invite = received[1];
  expect(invite.from).toBe("admin@beipoready.com");
  // Body may be quoted-printable (the signature has an em-dash): undo soft breaks and =XX escapes.
  const text = invite.raw.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  expect(text).toContain("invited to the Be IPO Ready CRM");
  expect(text).toContain("Rakesh Doshi, CEO has invited you to join the Be IPO Ready CRM as Viewer");
  expect(text).toContain(body.inviteUrl);

  // The Users page shows it as emailed via SMTP.
  await admin.goto("/users");
  await expect(admin.getByTestId("invitation-row").filter({ hasText: email })).toContainText("Emailed via SMTP");
});
