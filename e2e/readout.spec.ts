import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openReadableDemo(page: Page) {
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("table", { name: "Ledger entries" }).getByRole("row").nth(1).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Latest readout" })).toBeVisible({ timeout: 60_000 });
  return page.locator("section.readout-first");
}

test("a demo entry with a recorded result shows its readout first, with no button pressed, and it matches the stored version", async ({ page }) => {
  test.setTimeout(240_000);
  const readout = await openReadableDemo(page);

  // It is above everything else on the page: above the status line and the design.
  const top = await readout.evaluate((el) => el.getBoundingClientRect().top);
  const status = await page.getByText(/^Status: /).first().evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(status);
  await expect(readout).toContainText("Synthetic demo data");

  // The lift and range are the ones in the newest row of the Result versions table, which comes from the ledger.
  const versions = page.getByRole("table", { name: "Result versions" });
  const last = versions.locator("tbody tr").last();
  const lift = (await last.locator("td").nth(3).innerText()).trim();
  await expect(readout.locator(".readout-lift strong")).toHaveText(lift);
  const sentence = (await readout.getByRole("img", { name: /percent interval from/ }).getAttribute("aria-label")) ?? "";
  expect(sentence).toContain(`Lift ${lift}`);
  const rows = await versions.locator("tbody tr").count();
  await expect(readout).toContainText(`Version ${rows} of ${rows}`);

  // It is a reading of what is stored: nothing in it is a button or a field, and looking did not add a version.
  await expect(readout.getByRole("button")).toHaveCount(0);
  await expect(readout.getByRole("textbox")).toHaveCount(0);
  expect(await versions.locator("tbody tr").count()).toBe(rows);

  // The range picture is the same one the full readout uses: the bar stays in its box, the dot is inside the bar, and the
  // sentence says the range includes zero exactly when the bar reaches the zero line.
  await expect(readout.locator(".range-stage")).toBeVisible();
  const geometry = await readout.evaluate((el) => {
    const rect = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
    const zero = rect(".range-zero");
    const bar = rect(".range-bar");
    const dot = rect(".range-lift");
    const box = rect(".range-stage");
    return { zero: zero.left, bar: [bar.left, bar.right], dot: (dot.left + dot.right) / 2, box: [box.left, box.right] };
  });
  expect(geometry.bar[0]).toBeGreaterThanOrEqual(geometry.box[0] - 1);
  expect(geometry.bar[1]).toBeLessThanOrEqual(geometry.box[1] + 1);
  expect(geometry.dot).toBeGreaterThanOrEqual(geometry.bar[0] - 1);
  expect(geometry.dot).toBeLessThanOrEqual(geometry.bar[1] + 1);
  const crossesZero = geometry.bar[0] <= geometry.zero && geometry.bar[1] >= geometry.zero;
  expect(sentence.includes("includes zero")).toBe(crossesZero);
});

test("an entry with no recorded result shows no readout block", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: /still running/ }).click();
  await expect(page.getByText("Status: running")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Latest readout" })).toHaveCount(0);
});

for (const width of [390, 820, 1280]) {
  test(`the readout passes axe and the page fits at ${width} pixels`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReadableDemo(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).include("section.readout-first").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("the readout text and picture keep their contrast in both looks: marks 3 to 1, text 4.5 to 1", async ({ page }) => {
  test.setTimeout(300_000);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const readout = await openReadableDemo(page);
    const found = await readout.evaluate((el) => {
      const css = (sel: string, prop: string) => getComputedStyle(el.querySelector(sel)!).getPropertyValue(prop);
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        text: { lift: css(".readout-lift strong", "color"), label: css(".readout-lift span", "color"), tick: css(".range-ticks span", "color") },
        marks: { dot: css(".range-lift", "border-top-color") },
      };
    });
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const bg = parse(found.bg);
    for (const [k, v] of Object.entries(found.text)) expect(ratio(parse(v), bg), `${scheme} text ${k} ${v}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(parse(found.marks.dot), bg), `${scheme} dot`).toBeGreaterThanOrEqual(3);
  }
});
