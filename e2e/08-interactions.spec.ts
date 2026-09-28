import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

async function idOf(page: Page, api: "leads" | "clients", q: string) {
  const data = await (await page.request.get(`/api/${api}?q=${encodeURIComponent(q)}`)).json();
  return data[api][0].id as string;
}

test("RM logs interactions on a lead; newest first; filter by type; logged-by auto-filled", async ({ browser }) => {
  const rm = await as(browser, "rm1");
  const leadId = await idOf(rm, "leads", "Kulkarni");
  await rm.goto(`/leads/${leadId}`);

  const form = rm.getByTestId("log-interaction");
  await form.getByLabel("Interaction type").selectOption("WHATSAPP");
  await form.getByLabel("Summary").fill("Sent SME IPO timeline deck on WhatsApp.");
  await form.getByRole("button", { name: "Log interaction" }).click();

  const entries = rm.getByTestId("timeline-entry");
  await expect(entries.first()).toContainText("Sent SME IPO timeline deck");
  await expect(entries.first()).toContainText("logged by Rohan Sharma");
  await expect(entries).toHaveCount(3); // 2 seeded + 1 new

  await rm.getByRole("group", { name: "Filter by type" }).getByRole("button", { name: /^Email/ }).click();
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("checklist");

  // loggedById can't be spoofed, future dates are refused, RMs can't amend.
  const res = await rm.request.post("/api/interactions", {
    data: { leadId, type: "NOTE", occurredAt: new Date(Date.now() + 86400000).toISOString(), summary: "future" },
  });
  expect(res.status()).toBe(400);
  const { interactions } = await (await rm.request.get(`/api/interactions?leadId=${leadId}`)).json();
  expect((await rm.request.patch(`/api/interactions/${interactions[0].id}`, { data: { summary: "x", reason: "because" } })).status()).toBe(403);
  expect((await rm.request.delete(`/api/interactions/${interactions[0].id}`, { data: { reason: "because" } })).status()).toBe(403);
  await expect(rm.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("client timeline carries over lead-stage interactions and shows admin edit history", async ({ browser }) => {
  const viewer = await as(browser, "viewer");
  const clientId = await idOf(viewer, "clients", "Sahyadri");
  await viewer.goto(`/clients/${clientId}`);
  const timeline = viewer.getByTestId("timeline");
  await expect(timeline.getByText("Referral from a CA partner")).toBeVisible();
  await expect(timeline.getByText("lead stage")).toBeVisible();
  await expect(timeline.getByText("Price band finalised at ₹142–150")).toBeVisible();
  await timeline.getByText(/Edited by Rakesh Doshi/).click();
  await expect(timeline.getByText("Price band finalised at ₹140–148")).toBeVisible();
  await expect(timeline.getByText(/corrected to the final band/)).toBeVisible();
  await expect(viewer.getByTestId("log-interaction")).toHaveCount(0); // viewer is read-only
});

test("admin edit and remove require a reason; removed entries stay visible", async ({ browser }) => {
  const admin = await as(browser, "admin");
  const clientId = await idOf(admin, "clients", "Kaveri Agro");
  await admin.goto(`/clients/${clientId}`);
  const entry = admin.getByTestId("timeline-entry").filter({ hasText: "Shared DRHP chapter drafts" });

  // Edit
  await entry.getByRole("button", { name: "Edit" }).click();
  await admin.fill("#am-summary", "Shared DRHP chapter drafts (business, risk factors, T+4 feedback) for CFO review.");
  await admin.fill("#am-reason", "Added refund date");
  await admin.getByRole("button", { name: "Save edit" }).click();
  await expect(admin.getByTestId("timeline-entry").filter({ hasText: "T+4" })).toContainText("Edited by Rakesh Doshi");

  // Remove without reason is refused by the API
  const { interactions } = await (await admin.request.get(`/api/interactions?clientId=${clientId}`)).json();
  const target = interactions.find((i: { summary: string }) => i.summary.includes("T+4"));
  expect((await admin.request.delete(`/api/interactions/${target.id}`, { data: {} })).status()).toBe(400);

  const edited = admin.getByTestId("timeline-entry").filter({ hasText: "T+4" });
  await edited.getByRole("button", { name: "Remove" }).click();
  await admin.fill("#am-reason", "Logged against wrong client");
  await admin.getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(admin.getByText(/Removed by Rakesh Doshi .* reason: Logged against wrong client/)).toBeVisible();

  // RM sees the removal marker but not the removed text; compliance sees both.
  const rm = await as(browser, "rm2");
  await rm.goto(`/clients/${clientId}`);
  await expect(rm.getByText(/reason: Logged against wrong client/)).toBeVisible();
  await expect(rm.getByText(/T\+4/)).toHaveCount(0);
  const co = await as(browser, "compliance");
  await co.goto(`/clients/${clientId}`);
  await expect(co.getByText(/T\+4/)).toBeVisible();
});

test("leads with interactions cannot be deleted", async ({ browser }) => {
  const admin = await as(browser, "admin");
  const leadId = await idOf(admin, "leads", "Iyer Precision");
  const res = await admin.request.delete(`/api/leads/${leadId}`);
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/permanent record/);
});
