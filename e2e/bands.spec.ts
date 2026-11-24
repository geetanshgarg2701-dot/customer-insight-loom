import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { JOURNEYS_AS_OF, syntheticJourneys, type JourneyRow } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const DAY = 86_400_000;
const cutoff = Date.parse(JOURNEYS_AS_OF);
const n = (v: number) => v.toLocaleString("en-US");
const at = (r: JourneyRow, step: string) => Date.parse(r.times[r.path.indexOf(step)]);
const STAGES = ["Visit", "Product", "Cart"] as const;

/** The wait rule worked out straight from the generator, as the plan defines it. */
function parts(stage: number, days: number) {
  const wait = days * DAY;
  const people = rows.filter((r) => r.steps[stage] !== null);
  const moved = people.filter((r) => r.steps[stage + 1] !== null);
  return {
    reached: people.length,
    wentOn: moved.length,
    droppedOff: people.filter((r) => r.steps[stage + 1] === null && cutoff >= at(r, STAGES[stage]) + wait).length,
    stillWaiting: people.filter((r) => r.steps[stage + 1] === null && cutoff < at(r, STAGES[stage]) + wait).length,
  };
}

async function load(page: Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  const section = page.getByRole("region", { name: "Designed journey" });
  // The bands arrive a moment after the picture, once the wait rule has been counted.
  await expect(section.getByRole("group", { name: /^Cart, main step\. Entered .*dropped off/ })).toBeVisible({ timeout: 60_000 });
  return section;
}

const width = (edge: Locator) => edge.locator("path.react-flow__edge-path").first().evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));

test("each stage's three parts add up to the people who reached it, in the picture's name, in the table, and against the generator", async ({ page }) => {
  test.setTimeout(300_000);
  const section = await load(page);
  for (let k = 0; k < 3; k++) {
    const p = parts(k, 3);
    // The generator's own parts add up, so any disagreement below is the app's.
    expect(p.wentOn + p.droppedOff + p.stillWaiting).toBe(p.reached);
    const name = await section.getByRole("group", { name: new RegExp(`^${STAGES[k]}, main step\\.`) }).getAttribute("aria-label");
    expect(name).toBe(`${STAGES[k]}, main step. Entered ${n(p.reached)}, went on ${n(p.wentOn)}, dropped off ${n(p.droppedOff)}, still waiting ${n(p.stillWaiting)}.`);
  }
  await section.getByText("Show as table").click();
  const table = section.getByRole("table", { name: "Journey bands" });
  for (let k = 0; k < 3; k++) {
    const p = parts(k, 3);
    const row = table.getByRole("row", { name: new RegExp(`^${STAGES[k]} `) });
    await expect(row).toContainText(n(p.reached));
    await expect(row.getByRole("cell").nth(2)).toHaveText(n(p.wentOn));
    await expect(row.getByRole("cell").nth(3)).toHaveText(n(p.droppedOff));
    await expect(row.getByRole("cell").nth(4)).toHaveText(n(p.stillWaiting));
    await expect(row.getByRole("cell").nth(5)).toHaveText("yes");
  }
  await expect(table.getByRole("row", { name: /^Purchase / })).toContainText("not applicable");
});

test("band thickness is proportional to the count, on one scale for the whole flow", async ({ page }) => {
  test.setTimeout(300_000);
  const section = await load(page);
  const via = (a: string, b: string) => rows.filter((r) => r.path.some((s, i) => s === a && r.path[i + 1] === b)).length;
  const bands: [string, number][] = [
    ["Visit>Product", via("Visit", "Product")],
    ["Visit>Search", via("Visit", "Search")],
    ["Search>Product", via("Search", "Product")],
    ["Product>Cart", via("Product", "Cart")],
    ["Cart>Purchase", via("Cart", "Purchase")],
    ["Cart>Support", via("Cart", "Support")],
    ["Support>Purchase", via("Support", "Purchase")],
    ["Visit>drop", parts(0, 3).droppedOff],
    ["Product>drop", parts(1, 3).droppedOff],
    ["Cart>drop", parts(2, 3).droppedOff],
  ];
  const perPerson: number[] = [];
  for (const [id, count] of bands) {
    if (id === "Cart>Support") continue; // Support enders are dropped off at Cart, so their band is the drop off band
    const w = await width(section.locator(`.react-flow__edge[data-id="${id}"]`));
    expect(w, id).toBeGreaterThan(0);
    perPerson.push(w / count);
  }
  const lo = Math.min(...perPerson);
  const hi = Math.max(...perPerson);
  expect(hi / lo, "every band uses the same pixels per person").toBeLessThan(1.02);
  // The trunk leaving a stage is its direct band and its detour band together, so it is as thick as everyone who went on.
  const direct = await width(section.locator('.react-flow__edge[data-id="Visit>Product"]'));
  const detour = await width(section.locator('.react-flow__edge[data-id="Visit>Search"]'));
  expect((direct + detour) / parts(0, 3).wentOn).toBeCloseTo(hi, 1);
});

test("a panel with the numbers opens on hover and on keyboard focus, and closes again", async ({ page }) => {
  test.setTimeout(300_000);
  const section = await load(page);
  const panel = section.locator(".flow-panel");
  const cart = section.getByRole("group", { name: /^Cart, main step\./ });
  await expect(panel).not.toHaveAttribute("data-open", "true");

  await cart.hover();
  await expect(panel).toHaveAttribute("data-open", "true");
  const p = parts(2, 3);
  await expect(panel).toContainText(`${n(p.reached)} reached Cart.`);
  await expect(panel).toContainText(`${n(p.droppedOff)} dropped off.`);
  await expect(panel).toContainText(`${n(p.stillWaiting)} still waiting.`);
  await page.mouse.move(2, 2);
  await expect(panel).not.toHaveAttribute("data-open", "true");

  await cart.focus();
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel).toContainText(`${n(p.wentOn)} went on to Purchase`);
  await cart.blur();
  await expect(panel).not.toHaveAttribute("data-open", "true");

  // The end of the journey shows the exit conditions, and a detour belongs to the stage it leaves.
  await section.getByRole("group", { name: /^Purchase, main step\./ }).focus();
  await expect(panel).toContainText("reached the goal.");
  await section.getByRole("group", { name: /^Search, detour\./ }).focus();
  await expect(panel).toContainText("reached Visit.");
});

test("the boxes are gone: no dashed border anywhere, the connector points are invisible, and the React Flow credit stays", async ({ page }) => {
  test.setTimeout(300_000);
  const section = await load(page);
  const found = await section.evaluate((el) => {
    const dashed = [...el.querySelectorAll(".react-flow__node, .react-flow__node *")].filter((x) => getComputedStyle(x).borderTopStyle === "dashed").length;
    const handles = [...el.querySelectorAll(".react-flow__handle")];
    const visible = handles.filter((h) => getComputedStyle(h).opacity !== "0").length;
    const text = [...el.querySelectorAll(".react-flow__node")].map((x) => (x as HTMLElement).innerText).join(" ");
    return { dashed, handles: handles.length, visible, credit: el.querySelector(".react-flow__attribution")?.textContent ?? "", textLength: text.length };
  });
  expect(found.dashed).toBe(0);
  expect(found.handles).toBeGreaterThan(0);
  expect(found.visible).toBe(0);
  expect(found.credit).toContain("React Flow");
  await expect(section.locator(".react-flow__attribution")).toBeVisible();
  // The text on the picture is a name and a count for each step, not a block of numbers.
  expect(found.textLength).toBeLessThan(700);
});

for (const w of [390, 820, 1280]) {
  test(`the band picture passes axe with its panel open at ${w} pixels, and the page fits`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: w, height: 900 });
    const section = await load(page);
    await section.getByRole("group", { name: /^Cart, main step\./ }).focus();
    await expect(section.locator(".flow-panel")).toHaveAttribute("data-open", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='h-designed']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("the bands and their text keep their contrast in both looks: marks 3 to 1, text 4.5 to 1", async ({ page }) => {
  test.setTimeout(400_000);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const section = await load(page);
    // Hover the Cart so the selected color is measured too.
    await section.getByRole("group", { name: /^Cart, main step\./ }).focus();
    await expect(section.locator(".flow-panel")).toHaveAttribute("data-open", "true");
    const found = await section.evaluate((el) => {
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const css = (sel: string, prop: string, root: ParentNode = el) => getComputedStyle(root.querySelector(sel)!).getPropertyValue(prop);
      const stroke = (id: string) => css(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`, "stroke");
      const canvas = getComputedStyle(el.querySelector(".react-flow")!).backgroundColor;
      const pane = canvas === "rgba(0, 0, 0, 0)" ? getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() : canvas;
      return {
        pane: rgb(pane.startsWith("#") ? "" : pane),
        paneHex: pane,
        marks: { pillar: css(".flow-stage", "background-color"), trunk: stroke("Visit>Product"), dropped: stroke("Visit>drop"), selectedTrunk: stroke("Cart>Purchase"), selectedDrop: stroke("Cart>drop"), tabBorder: css(".flow-tab", "border-top-color") },
        text: { label: css(".flow-stage-label", "color"), count: css(".flow-stage-label b", "color"), stub: css(".flow-stub", "color"), tab: css(".flow-tab", "color") },
        panel: { text: css(".flow-panel", "color"), bg: css(".flow-panel", "background-color") },
      };
    });
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    // The pane is the surface color: read it from the page when the canvas itself is transparent.
    const hex = found.paneHex.startsWith("#") ? found.paneHex : null;
    const bg = hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : parse(found.paneHex);
    for (const [name, color] of Object.entries(found.marks)) expect(ratio(parse(color), bg), `${scheme} mark ${name} ${color}`).toBeGreaterThanOrEqual(3);
    for (const [name, color] of Object.entries(found.text)) expect(ratio(parse(color), bg), `${scheme} text ${name} ${color}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(parse(found.panel.text), parse(found.panel.bg)), `${scheme} panel text`).toBeGreaterThanOrEqual(4.5);
  }
});
