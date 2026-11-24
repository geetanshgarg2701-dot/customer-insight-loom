import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const WIDTHS = [390, 820, 1280];

async function loadJourneysBehindCart(page: Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.locator("dl.tiles")).toBeVisible({ timeout: 180_000 });
  await page.getByRole("group", { name: "Step to look behind" }).getByRole("button", { name: "Cart", exact: true }).click();
  const table = page.getByRole("table", { name: "Behind a step" });
  await expect(table.locator(".rb").first()).toBeVisible({ timeout: 60_000 });
  return table;
}

async function loadPipeline(page: Page) {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  await expect(page.locator("dl.tiles")).toBeVisible({ timeout: 180_000 });
}

/** What a picture's parts do against its row: on the axis, with the dot inside the whisker's reach. */
async function geometry(row: Locator) {
  return row.evaluate((el) => {
    const box = (sel: string) => (el.querySelector(sel) as HTMLElement).getBoundingClientRect();
    const rb = box(".rb");
    const whisker = box(".rb-whisker");
    const dot = box(".rb-dot");
    const caps = [...el.querySelectorAll(".rb-cap")].map((c) => c.getBoundingClientRect());
    return { rb: [rb.left, rb.right], whisker: [whisker.left, whisker.right], dot: [dot.left, dot.right], caps: caps.map((c) => [c.left, c.right]), crosses: el.querySelector(".rb")!.getAttribute("data-crosses") };
  });
}

const within = (inner: number[], outer: number[]) => inner[0] >= outer[0] - 1 && inner[1] <= outer[1] + 1;

test("the Journeys cart table has a picture for each rate, beside the written rate and range, on one axis that starts at zero", async ({ page }) => {
  test.setTimeout(300_000);
  const table = await loadJourneysBehindCart(page);

  // The axis is in the header, labeled, and starts at zero.
  const header = table.getByRole("columnheader", { name: /^Range picture, axis from 0 to \d+ percent$/ });
  await expect(header).toBeVisible();
  await expect(header.locator(".rb-ticks")).toBeVisible();
  const ticks = (await header.locator(".rb-ticks > span").allInnerTexts()).map(Number);
  expect(ticks.length).toBeGreaterThanOrEqual(3);
  expect(ticks[0]).toBe(0);
  for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);

  const rows = table.locator("tbody tr");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    // The written rate and range are still there, as text.
    const text = await row.locator("td").nth(4).innerText();
    expect(text, `row ${i}`).toMatch(/^\d+(\.\d+)? percent, \d+(\.\d+)? percent to \d+(\.\d+)? percent$/);
    // The picture says the same numbers in one sentence.
    const sentence = (await row.locator(".rb").getAttribute("aria-label")) ?? "";
    const [rate, low, high] = [...text.matchAll(/(\d+(?:\.\d+)?) percent/g)].map((m) => m[1]);
    expect(sentence).toContain(`Rate ${rate} percent, range from ${low} percent to ${high} percent`);
    expect(sentence).toContain(`on an axis from 0 to ${ticks[ticks.length - 1]} percent`);
    // The whisker and the dot never leave the axis.
    const g = await geometry(row);
    expect(within(g.whisker, g.rb), `whisker ${i}`).toBe(true);
    expect(within(g.dot, g.rb), `dot ${i}`).toBe(true);
    for (const c of g.caps) expect(within(c, g.rb), `cap ${i}`).toBe(true);
  }
});

test("the Pipeline outlook and period tables have pictures too, and a range that crosses zero reads as crossing", async ({ page }) => {
  test.setTimeout(300_000);
  await loadPipeline(page);

  const outlook = page.getByRole("table", { name: "Outlook for open deals" });
  const outlookHeader = outlook.getByRole("columnheader", { name: /^Range picture, axis from 0 to \d+ percent$/ });
  await expect(outlookHeader).toBeVisible();
  const outlookRows = outlook.locator("tbody tr");
  for (let i = 0; i < (await outlookRows.count()); i++) {
    const row = outlookRows.nth(i);
    expect(await row.locator("td").nth(3).innerText()).toMatch(/percent, .* percent to .* percent/);
    expect(await row.locator(".rb").getAttribute("aria-label")).toMatch(/^.+, chance of winning\. Rate .* percent, range from .* percent to .* percent, on an axis from 0 to \d+ percent\./);
    const g = await geometry(row);
    expect(within(g.whisker, g.rb)).toBe(true);
  }

  const periods = page.getByRole("table", { name: "Period comparison" });
  await periods.scrollIntoViewIfNeeded();
  const header = periods.getByRole("columnheader", { name: /^Range picture, axis from minus \d+ to plus \d+ points, zero in the middle$/ });
  await expect(header).toBeVisible();
  const rows = periods.locator("tbody tr");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  let crossing = 0;
  let clear = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const interval = await row.locator("td").nth(4).innerText();
    const [low, high] = [...interval.matchAll(/([+-]?\d+(?:\.\d+)?) points/g)].map((m) => Number(m[1]));
    const sentence = (await row.locator(".rb").getAttribute("aria-label")) ?? "";
    const g = await geometry(row);
    expect(within(g.whisker, g.rb)).toBe(true);
    const crosses = low <= 0 && high >= 0;
    // The picture, the sentence and the written interval agree on whether zero is inside the range.
    expect(g.crosses === "true", `picture ${i}`).toBe(crosses);
    expect(sentence.includes("includes zero"), `sentence ${i}`).toBe(crosses);
    expect(sentence).toContain(`${interval.replace(" to ", " to ")}`.replace(/\s+/g, " "));
    if (crosses) crossing++;
    else clear++;
  }
  expect(crossing + clear).toBe(count);
});

for (const width of WIDTHS) {
  test(`the changed tables pass axe and fit the page at ${width} pixels`, async ({ page }) => {
    test.setTimeout(400_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadPipeline(page);
    await page.getByRole("table", { name: "Period comparison" }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "pipeline sideways").toBeLessThanOrEqual(0);
    let axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
    expect(axe.violations.map((v) => `pipeline ${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);

    await loadJourneysBehindCart(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "journeys sideways").toBeLessThanOrEqual(0);
    axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
    expect(axe.violations.map((v) => `journeys ${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("the picture is in both looks and the colors are held: dot and whisker 3 to 1, ticks 4.5 to 1", async ({ page }) => {
  test.setTimeout(300_000);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const table = await loadJourneysBehindCart(page);
    const colors = await table.evaluate((t) => {
      const css = (sel: string, prop: string) => getComputedStyle(t.querySelector(sel)!).getPropertyValue(prop);
      return { dot: css(".rb-dot", "background-color"), whisker: css(".rb-whisker", "border-top-color"), axis: css(".rb-axis", "background-color"), tick: css(".rb-ticks > span", "color"), page: getComputedStyle(document.body).backgroundColor, surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() };
    });
    const parse = (c: string) => (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const bg = parse(colors.page);
    for (const mark of [colors.dot, colors.whisker, colors.axis]) expect(ratio(parse(mark), bg), `${scheme} mark ${mark}`).toBeGreaterThanOrEqual(3);
    expect(ratio(parse(colors.tick), bg), `${scheme} tick text`).toBeGreaterThanOrEqual(4.5);
  }
});
