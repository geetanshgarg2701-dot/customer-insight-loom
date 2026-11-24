import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function load(page: Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  return page.getByRole("region", { name: "Designed journey" });
}

test("a design is saved to a file and opened again in a fresh page, with nothing kept in the browser", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const canvas = await load(page);

  await canvas.getByLabel("Wait after step").selectOption({ label: "Product" });
  await canvas.getByLabel("Wait length").selectOption("7");
  await canvas.getByLabel("Inactivity rule").selectOption("90");
  await canvas.getByLabel("From step").selectOption("Purchase");
  await canvas.getByLabel("To step").selectOption("Visit");
  await canvas.getByRole("button", { name: "Add connection to the sketch" }).click();
  await expect(canvas.getByRole("alert")).toContainText("makes a loop");

  const [download] = await Promise.all([page.waitForEvent("download"), canvas.getByRole("button", { name: "Save the design to a file" }).click()]);
  expect(download.suggestedFilename()).toBe("journey-design.json");
  const file = (await download.path())!;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(saved).toMatchObject({ kind: "customer-insight-loom-journey-design", version: 1, wait: { after_step: 1, days: 7 }, inactive_days: 90, sketch: [{ from: "Purchase", to: "Visit" }] });
  expect(fs.readFileSync(file, "utf8")).not.toMatch(/@/);

  // A new browser context has no memory of the first one, so what comes back came from the file.
  const fresh = await browser.newContext();
  const page2 = await fresh.newPage();
  const canvas2 = await load(page2);
  await expect(canvas2.getByLabel("Wait length")).toHaveValue("3");
  await canvas2.getByLabel("Open a saved design").setInputFiles(file);
  await expect(canvas2.getByLabel("Wait after step")).toHaveValue("1");
  await expect(canvas2.getByLabel("Wait length")).toHaveValue("7");
  await expect(canvas2.getByLabel("Inactivity rule")).toHaveValue("90");
  await expect(canvas2.getByRole("alert")).toContainText("1 of the connections make a loop");
  await expect(canvas2.getByRole("alert")).toContainText("1 sketched connection, a 7 day wait, and an exit after 90 days inactive");
  await canvas2.getByRole("group", { name: /^Product, main step\./ }).focus();
  await expect(canvas2.locator(".flow-panel")).toContainText("Your designed wait of 7 days is set here.", { timeout: 60_000 });

  // The browser keeps nothing.
  const stored = await page2.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
  expect(stored).toEqual({ local: 0, session: 0, cookies: "" });
  await fresh.close();
});

test("a file that is not a saved design is refused whole and changes nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const canvas = await load(page);
  await canvas.getByLabel("Wait length").selectOption("7");
  const bad = path.join(os.tmpdir(), `bad-design-${Date.now()}.json`);
  fs.writeFileSync(bad, JSON.stringify({ kind: "customer-insight-loom-journey-design", version: 1, wait: { after_step: 0, days: 1 }, inactive_days: 14, sketch: [{ from: "Visit", to: "Nowhere" }] }));
  await canvas.getByLabel("Open a saved design").setInputFiles(bad);
  await expect(canvas.getByRole("alert")).toContainText("not a journey design this app saved");
  await expect(canvas.getByLabel("Wait length")).toHaveValue("7");
  await expect(canvas.getByLabel("Wait after step")).toHaveValue("2");
});

test("the save and open controls pass axe and fit a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
