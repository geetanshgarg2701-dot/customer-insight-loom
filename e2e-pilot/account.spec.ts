import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MOCK = "https://pilot-mock.test";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "content-type": "application/json",
};
const PASSWORD = "a long test password";

type Row = { id: string; workspace_id: string; name: string; file: unknown; updated_at: string };

/** A fake of the parts of the project the app uses. Nothing here reaches a real service. */
async function mockCloud(page: Page) {
  const rows: Row[] = [];
  const log: string[] = [];
  let workspaces: { id: string }[] = [];
  let n = 0;
  await page.route(`${MOCK}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    log.push(`${req.method()} ${path}`);
    const send = (status: number, body: unknown) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (path === "/auth/v1/signup") return send(200, { id: "u1", email: "pilot@example.com", aud: "authenticated", created_at: "2026-11-20T00:00:00Z", app_metadata: {}, user_metadata: {} });
    if (path === "/auth/v1/token") {
      const user = { id: "u1", email: "pilot@example.com", aud: "authenticated", role: "authenticated", created_at: "2026-11-20T00:00:00Z", app_metadata: {}, user_metadata: {} };
      return send(200, { access_token: "mock-access", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "mock-refresh", user });
    }
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
    if (path === "/rest/v1/workspaces") return send(200, workspaces);
    if (path === "/rest/v1/rpc/create_workspace") {
      workspaces = [{ id: "w1" }];
      return send(200, "w1");
    }
    if (path === "/rest/v1/saved_projects") {
      const q = url.searchParams;
      if (req.method() === "GET") {
        const id = q.get("id")?.replace("eq.", "");
        const name = q.get("name")?.replace("eq.", "");
        let out = rows;
        if (id) out = out.filter((r) => r.id === id);
        if (name) out = out.filter((r) => r.name === name);
        const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
        if (wantsObject) return send(200, out[0] ?? null);
        return send(200, out.map(({ id: i, name: nm, updated_at }) => ({ id: i, name: nm, updated_at })));
      }
      if (req.method() === "POST") {
        const body = req.postDataJSON() as { workspace_id: string; name: string; file: unknown };
        rows.push({ id: `p${++n}`, ...body, updated_at: "2026-11-20T10:00:00Z" });
        return route.fulfill({ status: 201, headers: CORS, body: "" });
      }
      if (req.method() === "PATCH") {
        const id = q.get("id")!.replace("eq.", "");
        const row = rows.find((r) => r.id === id);
        if (row) row.file = (req.postDataJSON() as { file: unknown }).file;
        return route.fulfill({ status: 204, headers: CORS });
      }
      if (req.method() === "DELETE") {
        const id = q.get("id")!.replace("eq.", "");
        const i = rows.findIndex((r) => r.id === id);
        if (i >= 0) rows.splice(i, 1);
        return route.fulfill({ status: 204, headers: CORS });
      }
    }
    return send(404, { message: `unmocked ${req.method()} ${path}` });
  });
  return { rows, log };
}

test("a pilot account signs in, saves the ledger, loads it back after a reload, and deletes it, talking only to its own project", async ({ page, context }) => {
  test.setTimeout(180_000);
  const foreign: string[] = [];
  const appOrigin = "http://localhost:3100";
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== appOrigin && url.origin !== MOCK) foreign.push(req.url());
  });
  const cloud = await mockCloud(page);

  await page.goto("/ledger");
  // A small ledger on purpose: the demo ledger is 2.6 MB, which fits now but makes the test slow.
  await page.getByLabel("Title", { exact: true }).fill("Pilot entry");
  await page.getByLabel("Hypothesis").fill("A short hypothesis");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("table", { name: "Ledger entries" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Account" }).click();

  // Short passwords and bad emails are refused before any request.
  await page.getByLabel("Email").fill("pilot@example.com");
  await page.getByLabel(/^Password/).fill("short");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("at least 12 characters");
  expect(cloud.log).toEqual([]);

  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Save the ledger" })).toBeVisible();
  expect(cloud.log).toContain("POST /rest/v1/rpc/create_workspace");

  await page.getByLabel("Project name").fill("Demo project");
  await page.getByRole("button", { name: "Save the ledger to my account" }).click();
  const table = page.getByRole("table", { name: "Saved projects" });
  await expect(table.getByRole("row", { name: /Demo project/ })).toBeVisible();
  expect(cloud.rows).toHaveLength(1);
  const stored = JSON.stringify(cloud.rows[0].file);
  expect(stored).toContain("entries");
  expect(stored).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i);

  // Saving under the same name replaces it.
  await page.getByRole("button", { name: "Save the ledger to my account" }).click();
  await expect(page.getByRole("status")).toContainText('Saved "Demo project".');
  expect(cloud.rows).toHaveLength(1);

  // Nothing is kept in the browser, and a reload signs the person out and empties the ledger.
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(storage).toEqual({ local: 0, session: 0, cookie: "" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in or make an account" })).toBeVisible();
  await page.getByLabel("Email").fill("pilot@example.com");
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Load Demo project into the ledger" }).click();
  await expect(page.getByRole("status")).toContainText('Loaded "Demo project" into the ledger.');
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ledger" }).click();
  await expect(page.getByRole("table", { name: "Ledger entries" }).getByRole("link", { name: "Pilot entry" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Account" }).click();

  // Delete everything, behind a typed word.
  const del = page.getByRole("button", { name: "Delete all my saved projects" });
  await expect(del).toBeDisabled();
  await page.getByLabel(/^Type delete/).fill("delete");
  await del.click();
  await expect(page.getByRole("status")).toContainText("Deleted 1 saved project from your account.");
  expect(cloud.rows).toHaveLength(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in or make an account" })).toBeVisible();
  expect(foreign).toEqual([]);
});

test("the account page has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await mockCloud(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/account");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
