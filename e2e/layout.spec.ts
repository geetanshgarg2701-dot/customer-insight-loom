import { expect, test, type Page } from "@playwright/test";

// The quiet editorial style applies to every screen, and every screen fits a phone, 375 pixels wide, with no sideways scroll.
const PAPER = "rgb(250, 248, 244)";

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
    test(`${path} uses the editorial style and fits a phone`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PAPER);
      expect(await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Georgia/);
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
