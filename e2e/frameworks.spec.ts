import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FIXTURE = path.join(__dirname, "fixtures", "frameworks-ledger.json");

test("frameworks are compared across imported tests, with Holm, the minimum test count and the association caveat", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/ledger");
  await page.getByLabel("Import ledger file").setInputFiles(FIXTURE);
  await expect(page.getByRole("table", { name: "Ledger entries" })).toBeVisible({ timeout: 60_000 });

  const section = page.getByRole("region", { name: "Frameworks compared across tests" });
  await expect(section.getByRole("status")).toContainText(/^PAS tests lifted more than FAB tests, by \d+\.\d percent relative, after the Holm correction across 1 comparison\./);
  await expect(section.getByRole("status")).toContainText("This is an association across tests.");

  const groups = section.getByRole("table", { name: "Lift by framework" });
  await expect(groups.getByRole("row", { name: /^PAS 5 \+\d+\.\d percent/ })).toBeVisible();
  await expect(groups.getByRole("row", { name: /^FAB 5 / })).toBeVisible();
  await expect(groups.getByRole("row", { name: /^AIDA 2 Too few tests, at least 5 are needed$/ })).toBeVisible();

  const pairs = section.getByRole("table", { name: "Framework pairs" });
  await expect(pairs.getByRole("row", { name: /^PAS against FAB .* Differs, as an association$/ })).toBeVisible();
  await expect(section.getByText("Left out: 1 with no framework tag.")).toBeVisible();
});

test("the framework section has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/ledger");
  await page.getByLabel("Import ledger file").setInputFiles(FIXTURE);
  await expect(page.getByRole("region", { name: "Frameworks compared across tests" })).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='h-frameworks']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("the ledger tiles add up to the entries, and match the status of each row in the table", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  const tiles = page.locator('dl[aria-label="The ledger at a glance"]');
  const value = async (name: string) => Number((await tiles.locator("> div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${name}$`) }) }).locator("dd").innerText()).replace(/,/g, ""));
  const entries = await value("Entries");
  expect(entries).toBe(4);
  expect((await value("Drafts")) + (await value("Registered or running")) + (await value("Ready to read or closed"))).toBe(entries);

  // The same split, counted from the status column of the table.
  const table = page.getByRole("table", { name: "Ledger entries" });
  const header = await table.getByRole("columnheader").allInnerTexts();
  const col = header.findIndex((h) => /^Status/.test(h));
  expect(col).toBeGreaterThanOrEqual(0);
  const statuses = (await table.getByRole("row").all()).slice(1);
  let drafts = 0;
  let underway = 0;
  for (const row of statuses) {
    const text = (await row.getByRole("cell").nth(col).innerText()).trim().toLowerCase();
    if (text === "draft") drafts++;
    else if (text === "registered" || text === "running") underway++;
  }
  expect(await value("Drafts")).toBe(drafts);
  expect(await value("Registered or running")).toBe(underway);

  // Creating a draft adds one to the entries and one to the drafts.
  await page.getByLabel("Title", { exact: true }).fill("Tile check");
  await page.getByLabel("Hypothesis").fill("A short hypothesis");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect.poll(() => value("Entries")).toBe(5);
  expect(await value("Drafts")).toBe(drafts + 1);
});
