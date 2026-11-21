import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function startAt(page: Page, minutes: string) {
  await page.goto("/data");
  await expect(page.getByLabel("Delete after")).toHaveValue("0");
  await page.getByLabel("Delete after").selectOption(minutes);
}

test("the timer is off until it is turned on, warns for the last minute, and activity moves the deadline", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await startAt(page, "15");
  const status = page.getByRole("region", { name: "Delete automatically after inactivity" }).getByRole("status");
  await expect(status).toContainText("Everything in this tab will be deleted after 15 minutes without activity. About 15 minutes left.");

  // Ten minutes pass with no activity, then a key press moves the deadline to ten minutes from now.
  await page.clock.fastForward("10:00");
  await expect(status).toContainText("About 5 minutes left.");
  await page.keyboard.press("Shift");
  await expect(status).toContainText("About 15 minutes left.");

  // Ten more minutes pass. It would have run out by now, but the key press moved it. Five minutes are left, so no warning yet.
  await page.clock.fastForward("10:00");
  await expect(status).toContainText("About 5 minutes left.");
  await expect(page.getByRole("alert").filter({ hasText: "deleted in under a minute" })).toHaveCount(0);

  // In the last minute a warning appears, and the button keeps the data and moves the deadline.
  await page.clock.fastForward("04:30");
  const warning = page.getByRole("alert").filter({ hasText: "deleted in under a minute" });
  await expect(warning).toBeVisible();
  // The fake clock stops animation frames, which Playwright waits for before a normal click, so this click skips that wait.
  await warning.getByRole("button", { name: "Keep my data" }).click({ force: true });
  await expect(warning).toHaveCount(0);
  await expect(status).toContainText("About 15 minutes left.");

  // Turning it off stops the timer.
  await page.getByLabel("Delete after").selectOption("0");
  await expect(status).toHaveCount(0);
  await page.clock.fastForward("01:00:00");
  await expect(page.getByRole("heading", { level: 1, name: "Your data in this tab" })).toBeVisible();
  await expect(page.getByText("Everything in this tab was deleted because it was inactive")).toHaveCount(0);
});

test("at the deadline everything in the tab is deleted and the page reloads with a note", async ({ page }) => {
  test.setTimeout(180_000);
  await page.clock.install();
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Your data" }).click();
  await expect(page.getByText("The ledger has 4 entries.")).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Delete after").selectOption("15");
  await expect(page.getByRole("region", { name: "Delete automatically after inactivity" }).getByRole("status")).toContainText("15 minutes");
  await page.clock.fastForward("16:00");

  // The tab is emptied and reloaded. The note says why, the timer is off, and the ledger is empty.
  await expect(page.getByText("Everything in this tab was deleted because it was inactive for longer than the time you set")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Delete after")).toHaveValue("0");
  await expect(page.getByText("The ledger has 0 entries.")).toBeVisible({ timeout: 60_000 });
});

test("the warning has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await page.setViewportSize({ width: 375, height: 812 });
  await startAt(page, "15");
  await page.clock.fastForward("14:30");
  const warning = page.getByRole("alert").filter({ hasText: "deleted in under a minute" });
  await expect(warning).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
