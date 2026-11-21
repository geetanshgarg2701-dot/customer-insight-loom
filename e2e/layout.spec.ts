import { expect, test, type Page } from "@playwright/test";

// The app look applies to every screen: the cool canvas, the system font and the sidebar with the current screen marked.
// Every screen fits a phone, 375 pixels wide, with no sideways scroll.
const CANVAS = "rgb(238, 241, 246)";

async function expectFits(page: Page, where: string) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${where} scrolls sideways at 375 pixels`).toBeLessThanOrEqual(client);
}

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const path of ["/", "/intake", "/ledger", "/journeys", "/pipeline", "/insights", "/compliance", "/drafts", "/ingest", "/data", "/check", "/methods", "/privacy", "/terms", "/no-such-page"]) {
    test(`${path} uses the app look and fits a phone`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(CANVAS);
      expect(await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^system-ui/);
      expect(await page.getByRole("navigation", { name: "Main" }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(32, 41, 74)");
      await expect(page).not.toHaveTitle(/Create Next App/);
      await expectFits(page, path);
    });
  }

  test("the entry screen, the widest one, fits a phone with the demo loaded", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/ledger");
    await page.getByRole("button", { name: "Load demo data" }).click();
    await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
    await expectFits(page, "/ledger with entries");
    const entryLink = page.getByRole("table", { name: "Ledger entries" }).getByRole("link").first();
    await entryLink.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expectFits(page, "/ledger/entry");
  });
});

test("the sidebar marks the current screen, follows client side links, and a skip link jumps past it", async ({ page }) => {
  await page.goto("/pipeline");
  // The first Tab lands on the skip link, which shows on focus and moves focus past the sidebar.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await nav.getByRole("link", { name: "Ledger" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Ledger" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Pipeline" })).not.toHaveAttribute("aria-current", "page");
});
