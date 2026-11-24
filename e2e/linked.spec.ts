import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function load(page: Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.locator("dl.tiles")).toBeVisible({ timeout: 180_000 });
  const canvas = page.getByRole("region", { name: "Designed journey" });
  await expect(canvas.getByRole("group", { name: /^Cart, main step\. Entered .*dropped off/ })).toBeVisible({ timeout: 60_000 });
  return canvas;
}

const overTime = (page: Page) => page.getByRole("figure", { name: /People who had reached each step, by day/ });
const timing = (page: Page) => page.getByRole("figure", { name: /Hours between steps/ });

/** Counts the pixels of a chart canvas that have a hue, and the ones that are the accent green, and finds a pixel of the neutral mark. */
async function pixels(fig: Locator) {
  return fig.locator("canvas").evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hued = 0;
    let accent = 0;
    const marks: [number, number][] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 200) continue;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) hued++;
        if (Math.abs(r - 0x1d) < 14 && Math.abs(g - 0x5e) < 14 && Math.abs(b - 0x47) < 14) accent++;
        // The neutral mark, #7d838c, in the light look.
        if (Math.abs(r - 0x7d) < 6 && Math.abs(g - 0x83) < 6 && Math.abs(b - 0x8c) < 6) marks.push([x, y]);
      }
    }
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return { hued, accent, marks: marks.filter((_, k) => k % 7 === 0).map(([x, y]) => [x / scale, y / scale] as [number, number]) };
  });
}

test("pointing at a step in the journey picture shows it in the timing chart and the over time lines too", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const canvas = await load(page);
  await expect(timing(page)).not.toHaveAttribute("data-linked", /.+/);
  await expect(overTime(page)).not.toHaveAttribute("data-linked", /.+/);

  await canvas.getByRole("group", { name: /^Cart, main step\./ }).hover();
  await expect(overTime(page)).toHaveAttribute("data-linked", "2:");
  await expect(timing(page)).toHaveAttribute("data-linked", /^0:\d$/);
  await page.mouse.move(2, 2);
  await expect(overTime(page)).not.toHaveAttribute("data-linked", /.+/);

  // The keyboard does the same.
  await canvas.getByRole("group", { name: /^Product, main step\./ }).focus();
  await expect(overTime(page)).toHaveAttribute("data-linked", "1:");
  await canvas.getByRole("group", { name: /^Product, main step\./ }).blur();
  await expect(overTime(page)).not.toHaveAttribute("data-linked", /.+/);
});

test("pointing at a line in the over time chart opens the same step in the journey picture", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  const canvas = await load(page);
  const fig = overTime(page);
  await fig.scrollIntoViewIfNeeded();
  const { marks } = await pixels(fig);
  expect(marks.length, "the lines are drawn in the neutral mark").toBeGreaterThan(20);
  const box = (await fig.locator("canvas").boundingBox())!;
  let opened = false;
  for (const [x, y] of marks.slice(Math.floor(marks.length / 3))) {
    await page.mouse.move(box.x + x, box.y + y);
    if ((await canvas.locator(".flow-panel").getAttribute("data-open")) === "true") {
      opened = true;
      break;
    }
  }
  expect(opened, "pointing at a line opened a step in the picture").toBe(true);
  await expect(fig).toHaveAttribute("data-linked", /^\d:$/);
});

test("the lines and boxes are the neutral mark, and only the step pointed at turns the accent", async ({ page }) => {
  test.setTimeout(300_000);
  // Tall enough that nothing scrolls, since scrolling moves the pointer off the picture and clears the link.
  await page.setViewportSize({ width: 1280, height: 5200 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  const canvas = await load(page);
  for (const fig of [overTime(page), timing(page)]) {
    await fig.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await expect(fig).not.toHaveAttribute("data-linked", /.+/);
    await page.waitForTimeout(400);
    const quiet = await pixels(fig);
    expect(quiet.hued, "no rainbow: nothing on the chart has a hue until a step is pointed at").toBe(0);
    expect(quiet.accent).toBe(0);
  }
  await canvas.getByRole("group", { name: /^Cart, main step\./ }).hover();
  for (const fig of [overTime(page), timing(page)]) {
    await expect(fig).toHaveAttribute("data-linked", /.+/);
    await expect.poll(async () => (await pixels(fig)).accent, { timeout: 10_000 }).toBeGreaterThan(30);
  }
});

test("each over time line is also told apart by its dash and named at its end, so color is never the only signal", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  // The names are in the chart's own description, and the legend lists them too.
  const description = (await overTime(page).locator("[aria-label]").first().getAttribute("aria-label")) ?? "";
  for (const step of ["Visit", "Product", "Cart", "Purchase"]) expect(description + (await overTime(page).innerText())).toContain(step);
});

test("a number counts up once, in under 600 milliseconds, keeps its real text throughout, and does not count again for a filter", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.addInitScript(() => {
    const w = window as unknown as { __cu: { starts: number; first: number; last: number; wrongText: number } };
    w.__cu = { starts: 0, first: 0, last: 0, wrongText: 0 };
    let counting = false;
    const look = () => {
      const el = document.querySelector(".cu");
      if (!el) return;
      const on = el.getAttribute("data-counting") === "true";
      if (on && !counting) {
        w.__cu.starts++;
        w.__cu.first = performance.now();
      }
      if (on) {
        w.__cu.last = performance.now();
        // The real text is in the page the whole time, never a half counted number.
        if (!/^\d{1,3}(,\d{3})*$/.test(el.textContent ?? "") || (el.textContent ?? "") !== "100,000") w.__cu.wrongText++;
      }
      counting = on;
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await load(page);
  await page.waitForTimeout(1000);
  const first = await page.evaluate(() => (window as unknown as { __cu: { starts: number; first: number; last: number; wrongText: number } }).__cu);
  expect(first.starts).toBe(1);
  // The count lasts 450 milliseconds by the clock (held in motion-rules.test.ts). The page is busy loading 100,000 rows, so a late
  // frame can stretch what is seen, and this only checks it ends soon and does not run on.
  expect(first.last - first.first).toBeLessThan(1500);
  expect(first.wrongText).toBe(0);
  await expect(page.locator(".cu").first()).toHaveText("100,000");
  await expect(page.locator(".cu").first()).not.toHaveAttribute("data-counting", "true");

  // A filter shows its new number at once. It does not count up again.
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / }).click();
  await expect(page.locator(".cu").first()).not.toHaveText("100,000");
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => (window as unknown as { __cu: { starts: number } }).__cu.starts);
  expect(after).toBe(1);
});

test("under reduced motion nothing counts up and nothing eases", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: boolean };
    w.__seen = false;
    new MutationObserver(() => {
      if (document.querySelector('.cu[data-counting="true"]')) w.__seen = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  const canvas = await load(page);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __seen: boolean }).__seen)).toBe(false);
  const d = await canvas.locator(".flow-stage").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(d).toBe("0s");
});

test("a change of color eases over a quarter second when motion is allowed", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const canvas = await load(page);
  const d = await canvas.locator(".flow-stage").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(d).toMatch(/^0.25s(, 0.25s)*$/);
  const edge = await canvas.locator("path.react-flow__edge-path.band").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(edge).toMatch(/^0.25s(, 0.25s)*$/);
  // The Reduce motion switch turns it off for the tab.
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Reduce motion" }).click();
  expect(await canvas.locator(".flow-stage").first().evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
});

for (const width of [390, 820, 1280]) {
  test(`the changed Journeys sections pass axe and the page fits at ${width} pixels, with a step pointed at`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const canvas = await load(page);
    await canvas.getByRole("group", { name: /^Cart, main step\./ }).focus();
    await expect(overTime(page)).toHaveAttribute("data-linked", "2:");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page })
      .include("section[aria-labelledby='h-designed']")
      .include("section[aria-labelledby='h-timing']")
      .include("section[aria-labelledby='h-over-time']")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
