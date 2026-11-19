import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PIPELINE_AS_OF, syntheticPipeline } from "../src/lib/demo/pipeline";
import { scrubberDates } from "../src/lib/charts/pipeline-drill";

const rows = syntheticPipeline(100_000, 21);
const n = (v: number) => v.toLocaleString("en-US");
const ms = (t: string) => Date.parse(t.replace(" ", "T") + "Z");

/** The pipeline on a date, counted a second way in plain code. */
function standing(date: string) {
  const d = Date.parse(date);
  const has = (t: string | null) => t !== null && ms(t) <= d;
  const after = (t: string | null) => t === null || ms(t) > d;
  const open = [0, 1, 2].map((i) => rows.filter((r) => has(r.entered[i]) && after(r.entered[i + 1]) && after(r.lostAt)).length);
  return { entered: rows.filter((r) => has(r.entered[0])).length, open, won: rows.filter((r) => has(r.entered[3])).length, lost: rows.filter((r) => has(r.lostAt)).length };
}

async function load(page: import("@playwright/test").Page) {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 deals/)).toBeVisible({ timeout: 180_000 });
}

test("records behind a stage list the generator's deals, page through them, and follow the filters", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Records behind a stage" });
  const table = section.getByRole("table", { name: "Records behind a stage" });

  // Proposal is the default. The first deal is the first in the generator to reach it.
  const atProposal = rows.map((r, i) => ({ r, i })).filter((x) => x.r.entered[2] !== null);
  await expect(table.locator("caption")).toHaveText(`Deals 1 to 20 of ${n(atProposal.length)}`);
  const first = atProposal[0];
  const firstRow = table.getByRole("row").nth(1);
  await expect(firstRow.getByRole("cell").nth(0)).toHaveText(`Synthetic deal ${first.i}`);
  await expect(firstRow.getByRole("cell").nth(3)).toHaveText(first.r.entered[2]!.slice(0, 10));

  await section.getByRole("button", { name: "Next page" }).click();
  await expect(table.locator("caption")).toHaveText(`Deals 21 to 40 of ${n(atProposal.length)}`);
  await expect(table.getByRole("row").nth(1).getByRole("cell").nth(0)).toHaveText(`Synthetic deal ${atProposal[20].i}`);

  await section.getByRole("group", { name: "Which deals" }).getByRole("button", { name: "Deals still open in it" }).click();
  const openHere = rows.filter((r) => r.status === "open" && r.stage === "Proposal").length;
  await expect(table.locator("caption")).toHaveText(`Deals 1 to 20 of ${n(openHere)}`);

  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^enterprise, / }).click();
  const entOpen = rows.filter((r) => r.segment === "enterprise" && r.status === "open" && r.stage === "Proposal").length;
  await expect(table.locator("caption")).toHaveText(`Deals 1 to 20 of ${n(entOpen)}`);
  await expect(table.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText("enterprise");
});

test("pipeline over time shows the generator's standing on each date, and every deal is counted once", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Pipeline over time" });
  const first = Math.min(...rows.map((r) => ms(r.entered[0]!)));
  const dates = scrubberDates(new Date(first).toISOString(), PIPELINE_AS_OF, 7);

  const check = async (date: string) => {
    const s = standing(date);
    await expect(section.getByText(new RegExp(`^On ${date.slice(0, 10)}, ${n(s.entered)} deals had entered\.`))).toBeVisible();
    const row = section.getByRole("table", { name: "Pipeline over time" }).getByRole("row").nth(1);
    await expect(row).toHaveText(`${date.slice(0, 10)}${s.open.map(n).join("")}${n(s.won)}${n(s.lost)}`);
    expect(s.open.reduce((a, b) => a + b, 0) + s.won + s.lost).toBe(s.entered);
  };

  await check(dates[dates.length - 1]);
  await section.getByRole("button", { name: "Previous week" }).click();
  await check(dates[dates.length - 2]);
  const slider = section.getByRole("slider", { name: "Date" });
  await slider.focus();
  await page.keyboard.press("Home");
  await check(dates[0]);
  await section.getByRole("button", { name: "Jump to the cutoff" }).click();
  await check(dates[dates.length - 1]);
});

test("the new pipeline sections have no axe violations and fit a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await page.getByRole("region", { name: "Records behind a stage" }).getByText("How the records were worked out").click();
  await page.getByRole("region", { name: "Pipeline over time" }).getByText("How the pipeline over time was worked out").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
