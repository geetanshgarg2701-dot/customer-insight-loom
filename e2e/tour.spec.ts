import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { navTo } from "./nav-helper";

test("the tour opens on its own, walks four steps, loads the demo ledger, and finishes", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: "Quick tour of the app" });
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Step 1 of 4")).toBeVisible();
  await expect(tour.getByRole("heading", { name: "Write the bet down first" })).toBeVisible();
  await expect(tour.getByRole("button", { name: "Back" })).toBeDisabled();

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("Step 2 of 4")).toBeVisible();
  await tour.getByRole("button", { name: "Load the demo ledger" }).click();
  await expect(tour.getByRole("status")).toContainText("Loaded 4 synthetic demo experiments.", { timeout: 120_000 });

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("Step 3 of 4")).toBeVisible();
  await expect(tour.getByRole("link", { name: "Open Journeys" })).toHaveAttribute("href", /\/journeys\/?$/);
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour.getByText("Step 2 of 4")).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("Step 4 of 4")).toBeVisible();
  await expect(tour.getByRole("link", { name: "Open the Email check" })).toHaveAttribute("href", /\/compliance\/?$/);
  await expect(tour.getByRole("button", { name: "Next" })).toHaveCount(0);
  await tour.getByRole("button", { name: "Finish" }).click();
  await expect(tour).toBeHidden();

  // The demo ledger is really there.
  await navTo(page, "Ledger");
  await expect(page.getByRole("table", { name: "Ledger entries" })).toBeVisible({ timeout: 60_000 });
});

test("the tour card is centered on the screen, on a laptop and on a phone, and fits inside it", async ({ page }) => {
  for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await page.goto("/");
    const tour = page.getByRole("dialog", { name: "Quick tour of the app" });
    await expect(tour).toBeVisible();
    const box = (await tour.boundingBox())!;
    // Centered across and down, to within a few pixels, and wholly on the screen.
    expect(Math.abs(box.x + box.width / 2 - size.width / 2), `${size.width}px wide, across`).toBeLessThan(4);
    expect(Math.abs(box.y + box.height / 2 - size.height / 2), `${size.width}px wide, down`).toBeLessThan(4);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  }
});

test("Skip and Escape close it at once, it does not reopen on its own in the same visit, and the button brings it back", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: "Quick tour of the app" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Skip the tour" }).click();
  await expect(tour).toBeHidden();

  // Away and back in the same visit: it stays closed.
  await navTo(page, "Methods");
  await expect(page.getByRole("heading", { level: 1, name: "Methods" })).toBeVisible();
  await navTo(page, "Home");
  await expect(page.getByRole("heading", { level: 1, name: "Customer Insight Loom" })).toBeVisible();
  await expect(tour).toBeHidden();

  await page.getByRole("button", { name: "Take the 2 minute tour" }).click();
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Step 1 of 4")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();

  // Nothing is remembered between visits, because the app stores nothing, so a reload shows it again.
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Quick tour of the app" })).toBeVisible();
});

test("focus stays inside the open tour, and the tour has no axe violations and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: "Quick tour of the app" });
  await expect(tour).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    // Focus is in the dialog, or has left the page for the browser's own bar. It is never on the page behind.
    const behind = await page.evaluate(() => {
      const el = document.activeElement;
      return el !== null && el !== document.body && !el.closest("dialog");
    });
    expect(behind).toBe(false);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
