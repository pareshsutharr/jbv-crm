import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "Password@123";
/** The seeded administrator (Rakesh Doshi, CEO) has its own password. */
export const ADMIN_PASSWORD = "beipoready@123456";
export const USERS = {
  admin: "admin@beipoready.com",
  compliance: "compliance@beipoready.com",
  rm1: "rohan@beipoready.com", // Rohan Sharma
  rm2: "priya@beipoready.com", // Priya Nair
  viewer: "viewer@beipoready.com",
} as const;

export const passwordFor = (email: string) => (email === USERS.admin ? ADMIN_PASSWORD : PASSWORD);

export async function login(page: Page, email: string, password = passwordFor(email)) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL("/");
}

/** A fresh, signed-in page for one of the seeded users. */
export async function as(browser: Browser, who: keyof typeof USERS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return page;
}

export async function json<T = Record<string, unknown>>(res: { json(): Promise<unknown> }) {
  return (await res.json()) as T;
}
