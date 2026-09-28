import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// Runs against the provider mock (e2e/mocks/provider-mock.mjs) — see `npm run start:e2e`.
const MOCK = "http://localhost:4455";
type LogEntry = { method: string; path: string; auth: string | null; body: string };
const mockLog = async (page: Page) => (await (await page.request.get(`${MOCK}/__log`)).json()) as LogEntry[];

async function clientId(page: Page, q: string) {
  return ((await (await page.request.get(`/api/clients?q=${encodeURIComponent(q)}`)).json()).clients[0] as { id: string }).id;
}

test.describe.configure({ mode: "serial" });

test("RM connects Google via OAuth and syncs only CRM-relevant Gmail messages", async ({ browser }) => {
  const rm = await as(browser, "rm1");
  await rm.goto("/account");
  const google = rm.getByTestId("integration-google");
  await expect(google).toContainText("Not connected");
  await google.getByRole("link", { name: "Connect" }).click();
  await expect(rm).toHaveURL(/\/account\?connected=google/);
  await expect(google).toContainText("Connected");
  await expect(google).toContainText("rohan@beipoready.com");

  await google.getByRole("button", { name: "Sync emails now" }).click();
  await expect(rm.getByTestId("sync-result")).toHaveText("Checked 4 messages, 3 matched a lead or client.");

  // Contact match + company-domain match land on the client; the personal email is never stored.
  await rm.goto(`/clients/${await clientId(rm, "Sahyadri")}`);
  const threads = rm.getByTestId("email-threads");
  await expect(threads).toContainText("Updated cap table for RHP");
  await expect(threads).toContainText("Plant visit schedule");
  await expect(threads).not.toContainText("Dinner on Saturday?");
  await threads.getByText("Updated cap table for RHP").click();
  await expect(rm.getByTestId("email-message").first()).toContainText("sharing the updated cap table");

  // Outbound mail to a lead's address lands on the lead.
  const lead = (await (await rm.request.get("/api/leads?q=Kulkarni")).json()).leads[0];
  await rm.goto(`/leads/${lead.id}`);
  await expect(rm.getByTestId("email-threads")).toContainText("Pre-IPO readiness checklist");

  // Re-syncing doesn't duplicate.
  const res = await rm.request.post("/api/integrations/sync");
  const { results } = await res.json();
  expect(results[0].stored).toBe(3);
  const msgs = (await (await rm.request.get(`/api/emails?clientId=${await clientId(rm, "Sahyadri")}`)).json()).messages as { subject: string }[];
  expect(msgs.filter((m) => m.subject === "Updated cap table for RHP")).toHaveLength(1);
});

test("schedule a Google Meet from the client page: calendar event + invites; complete logs the outcome", async ({ browser }) => {
  const rm = await as(browser, "rm1");
  await rm.request.post(`${MOCK}/__reset`);
  await rm.goto(`/clients/${await clientId(rm, "Sahyadri")}`);
  await rm.getByRole("button", { name: "+ Schedule" }).click();
  await rm.fill("#mt-title", "Post-listing investor relations plan");
  await expect(rm.locator("#mt-provider")).toHaveValue("GOOGLE_MEET");
  await rm.getByRole("button", { name: "Schedule", exact: true }).click();
  // The share step confirms the calendar invite went out; close it to get back to the list.
  await expect(rm.getByTestId("meeting-scheduled")).toContainText("Calendar invite emailed");
  await rm.getByRole("button", { name: "Done" }).click();

  const row = rm.getByTestId("meeting-row").filter({ hasText: "Post-listing investor relations plan" });
  await expect(row).toContainText("invite sent");
  await expect(row.getByTestId("join-link")).toHaveAttribute("href", "https://meet.google.com/mock-abcd-efg");

  const insert = (await mockLog(rm)).find((l) => l.method === "POST" && l.path.endsWith("/calendar/v3/calendars/primary/events"))!;
  const ev = JSON.parse(insert.body);
  expect(ev.attendees.map((a: { email: string }) => a.email)).toContain("suresh@sahyadrirenewables.in");
  expect(ev.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  expect(insert.auth).toMatch(/^Bearer g-at-/);

  await row.getByRole("button", { name: "Complete" }).click();
  await rm.fill("#cm-text", "Agreed quarterly investor calls; IR agency shortlist by next week.");
  await rm.getByRole("button", { name: "Save outcome" }).click();
  await expect(rm.getByTestId("timeline")).toContainText("Agreed quarterly investor calls");
});

test("cancel removes the calendar event; send email from the CRM via Gmail", async ({ browser }) => {
  const rm = await as(browser, "rm1");
  await rm.request.post(`${MOCK}/__reset`);
  const id = await clientId(rm, "Sahyadri");
  const created = await rm.request.post("/api/meetings", {
    data: { clientId: id, title: "Temp sync", startAt: new Date(Date.now() + 86_400_000).toISOString(), durationMin: 30, provider: "GOOGLE_MEET", attendees: [] },
  });
  const { meeting } = await created.json();
  expect((await rm.request.patch(`/api/meetings/${meeting.id}`, { data: { action: "cancel", reason: "Client travelling" } })).status()).toBe(200);
  expect((await mockLog(rm)).some((l) => l.method === "DELETE" && l.path.includes("/events/gev-1"))).toBe(true);

  // Everyone sends from the firm mailbox: the admin sets it up once (here: the mock SMTP server).
  const admin = await as(browser, "admin");
  await admin.request.delete("/api/integrations/google");
  expect((await admin.request.patch("/api/settings/system-email", { data: { smtp: { host: "localhost", port: 1026, user: "admin@beipoready.com", pass: "firm-password", from: "admin@beipoready.com", secure: false } } })).status()).toBe(200);

  await rm.goto(`/clients/${id}`);
  await rm.getByRole("button", { name: "+ Email" }).click();
  await expect(rm.locator("#em-to")).toHaveValue("suresh@sahyadrirenewables.in");
  await rm.fill("#em-subject", "Listing day checklist");
  await rm.fill("#em-body", "Dear Suresh ji,\nPlease find the listing day checklist.");
  await rm.getByRole("button", { name: "Send" }).click();
  await expect(rm.getByTestId("email-threads")).toContainText("Listing day checklist");
  // Sent from the firm address as the RM, with replies routed to the RM.
  const [mail] = (await (await rm.request.get(`${MOCK}/__smtp`)).json()) as { from: string; to: string[]; raw: string }[];
  expect(mail.from).toBe("admin@beipoready.com");
  expect(mail.to).toEqual(["suresh@sahyadrirenewables.in"]);
  expect(mail.raw).toContain("From: Rohan Sharma via Be IPO Ready <admin@beipoready.com>");
  expect(mail.raw).toContain("Reply-To: rohan@beipoready.com");
  expect(mail.raw).toContain("Subject: Listing day checklist");
  await admin.request.patch("/api/settings/system-email", { data: { smtp: null } });
});

test("RM connects Microsoft: Teams meeting and Outlook sync", async ({ browser }) => {
  const rm = await as(browser, "rm2");
  await rm.goto("/account");
  await rm.getByTestId("integration-microsoft").getByRole("link", { name: "Connect" }).click();
  await expect(rm).toHaveURL(/connected=microsoft/);

  const kaveri = await clientId(rm, "Kaveri Agro");
  const res = await rm.request.post("/api/meetings", {
    data: { clientId: kaveri, title: "RHP review", startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMin: 60, provider: "TEAMS", attendees: [{ email: "latha.rao@kaveriagro.com", name: "Latha Rao" }] },
  });
  expect(res.status()).toBe(201);
  expect((await res.json()).meeting.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/mock");

  const sync = await (await rm.request.post("/api/integrations/sync")).json();
  expect(sync.results.find((r: { provider: string }) => r.provider === "MICROSOFT").stored).toBe(1);
  await rm.goto(`/clients/${kaveri}`);
  await expect(rm.getByTestId("email-threads")).toContainText("Re: DRHP chapter drafts for review");
});

test("guards: no calendar → needs a link; tampered OAuth state; disconnect; cron secret", async ({ browser }) => {
  const co = await as(browser, "compliance");
  const id = await clientId(co, "Patel Precision");
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const noAccount = await co.request.post("/api/meetings", { data: { clientId: id, title: "KYC walkthrough", startAt: start, provider: "GOOGLE_MEET" } });
  expect(noAccount.status()).toBe(400);
  expect((await noAccount.json()).error).toMatch(/Connect your Google account/);
  const zoom = await co.request.post("/api/meetings", { data: { clientId: id, title: "KYC walkthrough", startAt: start, provider: "ZOOM", joinUrl: "https://zoom.us/j/123" } });
  expect(zoom.status()).toBe(201);
  expect((await co.request.post("/api/emails", { data: { clientId: id, to: ["hitesh@patelprecision.co.in"], subject: "x", body: "y" } })).status()).toBe(400);

  // Viewers can't schedule; other RMs can't see Rohan's client's emails.
  const viewer = await as(browser, "viewer");
  expect((await viewer.request.post("/api/meetings", { data: { clientId: id, title: "x", startAt: start, provider: "PHONE" } })).status()).toBe(403);
  const rm2 = await as(browser, "rm2");
  expect((await rm2.request.get(`/api/emails?clientId=${await clientId(co, "Sahyadri")}`)).status()).toBe(404);

  const rm = await as(browser, "rm1");
  await rm.goto("/api/integrations/google/callback?code=gcode&state=forged.state");
  await expect(rm).toHaveURL(/error=invalid_state/);

  await rm.goto("/account");
  rm.once("dialog", (d) => d.accept());
  await rm.getByTestId("integration-google").getByRole("button", { name: "Disconnect" }).click();
  await expect(rm.getByTestId("integration-google")).toContainText("Not connected");

  expect((await rm.request.post("/api/cron/email-sync")).status()).toBe(401);
});
