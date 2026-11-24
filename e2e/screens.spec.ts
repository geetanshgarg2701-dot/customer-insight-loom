import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PATHS = ["/ledger", "/intake", "/compliance", "/drafts", "/ingest", "/data", "/check", "/insights", "/methods", "/privacy", "/terms", "/pipeline", "/journeys", "/no-such-page"];

/** What the look rules out, counted on what is on show: glass, glow, a colored stripe down one side, and a gradient fill. */
async function counts(page: Page) {
  return page.evaluate(() => {
    const out = { glass: 0, glow: 0, stripe: 0, gradient: 0 };
    for (const el of document.querySelectorAll("body *:not(nextjs-portal):not(nextjs-portal *)")) {
      if (el.getClientRects().length === 0) continue;
      const s = getComputedStyle(el);
      if (s.backdropFilter !== "none") out.glass++;
      if (s.boxShadow !== "none" && !s.boxShadow.includes("inset") && !el.closest("nav")) out.glow++;
      if (parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderLeftWidth) > parseFloat(s.borderTopWidth) && !el.className.toString().includes("range-")) out.stripe++;
      if (s.backgroundImage.includes("gradient") && !el.className.toString().includes("sk")) out.gradient++;
    }
    return out;
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`no screen has glass, glow, a side stripe or a gradient fill, in the ${scheme} look`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await counts(page), path).toEqual({ glass: 0, glow: 0, stripe: 0, gradient: 0 });
    }
    // The menu panels are only on show once opened, so each is opened and counted too.
    await page.goto("/ledger");
    for (const group of ["Experiments", "Customers", "Your data"]) {
      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: group, exact: true }).click();
      await expect(page.locator("ul.drop.open")).toBeVisible();
      expect(await counts(page), `${group} menu`).toEqual({ glass: 0, glow: 0, stripe: 0, gradient: 0 });
    }
  });
}

test("the 404 page is the home headline in miniature, with a lighter last line and one dark pill", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  const light = page.locator("h1 .light");
  await expect(light).toHaveText("It may have moved, or the link has a typo.");
  expect(await light.evaluate((el) => ({ weight: getComputedStyle(el).fontWeight, color: getComputedStyle(el).color }))).toEqual({ weight: "300", color: "rgb(90, 98, 112)" });
  const pill = page.getByRole("link", { name: "Go to the home page" });
  await expect(pill).toBeVisible();
  expect(await pill.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderTopLeftRadius }))).toMatchObject({ bg: "rgb(21, 23, 27)" });
  await expect(page.getByRole("main").getByRole("link")).toHaveCount(1);
});

test("data intake says what happens next until a file is chosen, and the file picker looks like a control", async ({ page }) => {
  await page.goto("/intake");
  const hint = page.getByText("After you choose a file, its columns are listed here");
  await expect(hint).toBeVisible();
  const picker = page.getByLabel("CSV file");
  expect(await picker.evaluate((el) => ({ style: getComputedStyle(el).borderTopStyle, width: getComputedStyle(el).borderTopWidth }))).toEqual({ style: "dashed", width: "1px" });
  await picker.setInputFiles({ name: "campaigns.csv", mimeType: "text/csv", buffer: Buffer.from("campaign,spend\nspring,100\nsummer,250\n") });
  await expect(hint).toBeHidden();
});

test("a group of controls is set off by a hairline, not boxed", async ({ page }) => {
  await page.goto("/ledger");
  const group = page.locator("fieldset").first();
  expect(await group.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth];
  })).toEqual(["1px", "0px", "0px", "0px"]);
});

test("the pipeline filters sit close together", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toBeVisible({ timeout: 180_000 });
  const rows = filters.getByRole("group");
  expect(await rows.count()).toBe(4);
  const margins = await rows.evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).marginBottom)));
  for (const m of margins) expect(m).toBeLessThanOrEqual(6);
});

test("every screen passes axe in the light look too, with the chain and the file picker in view", async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  for (const path of ["/intake", "/no-such-page", "/ledger"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
    expect(axe.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
  await page.goto("/insights");
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  await expect(page.getByText("Evidence chain")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `/insights ${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
