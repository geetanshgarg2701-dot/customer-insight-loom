import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { navTo } from "./nav-helper";

async function loadDemo(page: import("@playwright/test").Page) {
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
}

test("the data screen shows what the tab holds and its memory, nudges to export, and deletes everything after a typed confirmation", async ({ page }) => {
  test.setTimeout(240_000);
  await loadDemo(page);
  await navTo(page, "Your data");
  await expect(page.getByRole("heading", { level: 1, name: "Your data in this tab" })).toBeVisible();

  // The memory meter reads real numbers from the database, against its own limit.
  const memory = page.getByRole("region", { name: "Memory" });
  await expect(memory.getByRole("status")).toContainText(/MiB of [\d.]+ (?:MiB|GiB)?/, { timeout: 60_000 });
  const text = await memory.getByRole("status").innerText();
  expect(text).toMatch(/^[\d.]+ MiB of [\d.]+ MiB, [\d.]+ percent\. Plenty of room\./);
  await expect(memory.getByRole("meter", { name: "Database memory in use, against its limit" })).toBeVisible();

  // The tables of the ledger are listed with exact row counts.
  const held = page.getByRole("region", { name: "What this tab holds" });
  await expect(held.getByRole("row", { name: /^ledger_entries 4$/ })).toBeVisible();
  await expect(held.getByText("The ledger has 4 entries.")).toBeVisible();

  // Nothing has been exported from this tab yet, so it nudges. An export clears the nudge.
  const keep = page.getByRole("region", { name: "Keep the ledger" });
  await expect(keep.getByRole("status")).toContainText("This ledger has 4 entries and has not been exported from this tab.");
  const [download] = await Promise.all([page.waitForEvent("download"), keep.getByRole("button", { name: "Export the ledger" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^evidence-ledger-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(keep.getByRole("status")).toHaveCount(0);

  // Delete is closed until the word is typed, and a wrong word keeps it closed.
  const del = page.getByRole("region", { name: "Delete everything in this tab" });
  const button = del.getByRole("button", { name: "Delete everything and reload" });
  await expect(button).toBeDisabled();
  await del.getByLabel(/^Type delete to confirm/).fill("remove");
  await expect(button).toBeDisabled();
  await del.getByLabel(/^Type delete to confirm/).fill(" Delete ");
  await expect(button).toBeEnabled();
  await button.click();

  // The page reloads, says so, and holds nothing.
  await expect(page.getByRole("status").filter({ hasText: "Everything in this tab was deleted, and the page was reloaded." })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "What this tab holds" }).getByText("Nothing. No table is loaded.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("The ledger has 0 entries.")).toBeVisible();
  expect(page.url()).not.toContain("#deleted");
});

test("a screen that loaded 100,000 rows has dropped them by the time the data screen is opened, and the meter says so", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  await navTo(page, "Your data");

  const memory = page.getByRole("region", { name: "Memory" });
  await expect(memory.getByRole("status")).toContainText("MiB of", { timeout: 60_000 });
  const held = page.getByRole("region", { name: "What this tab holds" });
  await expect(held.getByRole("row", { name: /^ledger_entries 0$/ })).toBeVisible();
  await expect(held.getByRole("row", { name: /^journeys/ })).toHaveCount(0);
  await expect(held.getByRole("row", { name: /^journey_comments/ })).toHaveCount(0);
  const mib = Number(/^([\d.]+) MiB of/.exec(await memory.getByRole("status").innerText())![1]);
  expect(mib).toBeLessThan(10);
});

test("the data screen has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await loadDemo(page);
  await navTo(page, "Your data");
  await expect(page.getByRole("region", { name: "Memory" }).getByRole("status")).toContainText("MiB of", { timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
