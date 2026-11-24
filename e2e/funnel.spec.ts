import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [390, 820, 1280];

async function loadPipeline(page: Page) {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  await expect(page.locator("dl.tiles")).toBeVisible({ timeout: 180_000 });
  const section = page.locator("section[aria-labelledby='h-funnel']");
  await expect(section.locator(".fb-pillar").first()).toBeVisible({ timeout: 60_000 });
  return section;
}

const counts = async (section: ReturnType<Page["locator"]>) =>
  (await section.getByRole("table", { name: "Stage funnel" }).locator("tbody tr").allInnerTexts()).map((r) => Number(r.split(/\s+/)[1].replace(/,/g, "")));

test("every pillar is its count on one scale from zero, and each pillar's two slices add up", async ({ page }) => {
  test.setTimeout(240_000);
  const section = await loadPipeline(page);
  const c = await counts(section);
  expect(c.length).toBeGreaterThan(2);
  const pillars = await section.locator(".fb-pillar").evaluateAll((els) => els.map((e) => Number(e.getAttribute("height"))));
  const tops = await section.locator(".fb-pillar").evaluateAll((els) => els.map((e) => Number(e.getAttribute("y"))));
  expect(pillars).toHaveLength(c.length);
  // One scale for all of them, and it starts at zero: the first pillar is the whole height.
  pillars.forEach((h, i) => expect(h / c[i]).toBeCloseTo(pillars[0] / c[0], 6));
  expect(new Set(tops).size).toBe(1);
  // The trunk leaving a stage is as thick as the next pillar, and the slice that did not go on makes up the rest.
  const trunks = await section.locator(".fb-trunk").evaluateAll((els) => els.map((e) => (e as SVGGraphicsElement).getBBox().height));
  const drops = await section.locator(".fb-drop").evaluateAll((els) => els.map((e) => (e as SVGGraphicsElement).getBBox().height));
  trunks.forEach((h, i) => expect(h).toBeCloseTo(pillars[i + 1], 1));
  expect(drops.length).toBe(trunks.length);
  // The names carry the same numbers, so nothing depends on seeing the picture.
  const labels = await section.locator(".fb-stage").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(labels).toHaveLength(c.length);
  labels.forEach((label, i) => expect(label).toContain(` ${c[i].toLocaleString("en-US")}, deals that reached it.`));
  // Did not reach text: its number is the stage's count minus the next stage's.
  const notes = await section.locator(".fb-note").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  notes.forEach((t, i) => expect(t).toContain((c[i] - c[i + 1]).toLocaleString("en-US")));
});

test("a stage is pressed to filter by it, with the pointer and with the keyboard, and the state is in its name", async ({ page }) => {
  test.setTimeout(240_000);
  const section = await loadPipeline(page);
  const before = await counts(section);
  const qualified = section.getByRole("button", { name: /^Qualified / });
  await expect(qualified).toHaveAttribute("aria-pressed", "false");
  await qualified.click();
  await expect(qualified).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await counts(section))[0]).not.toBe(before[0]);
  await qualified.focus();
  await page.keyboard.press("Enter");
  await expect(qualified).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await counts(section))[0]).toBe(before[0]);
});

for (const width of WIDTHS) {
  test(`the funnel passes axe and the page fits at ${width} pixels`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadPipeline(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='h-funnel']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("the funnel keeps its contrast in both looks: marks 3 to 1, text 4.5 to 1", async ({ page }) => {
  test.setTimeout(300_000);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const section = await loadPipeline(page);
    await section.getByRole("button", { name: /^Qualified / }).click();
    await expect(section.getByRole("button", { name: /^Qualified / })).toHaveAttribute("aria-pressed", "true");
    const found = await section.evaluate((el) => {
      const css = (sel: string, prop: string) => getComputedStyle(el.querySelector(sel)!).getPropertyValue(prop);
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        marks: { pillar: css(".fb-pillar.fb-on", "fill"), unselectedPillar: css(".fb-pillar.fb-ink", "fill"), trunk: css(".fb-trunk", "fill"), drop: css(".fb-drop", "fill") },
        text: { name: css(".fb-name", "fill"), count: css(".fb-count", "fill"), note: css(".fb-note", "fill") },
      };
    });
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const bg = parse(found.bg);
    for (const [k, v] of Object.entries(found.marks)) expect(ratio(parse(v), bg), `${scheme} mark ${k} ${v}`).toBeGreaterThanOrEqual(3);
    for (const [k, v] of Object.entries(found.text)) expect(ratio(parse(v), bg), `${scheme} text ${k} ${v}`).toBeGreaterThanOrEqual(4.5);
  }
});
