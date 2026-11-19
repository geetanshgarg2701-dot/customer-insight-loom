import { expect, test } from "@playwright/test";

test("the pipeline views filter each other on 100,000 synthetic deals, and the update is timed", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) foreign.push(req.url());
  });

  await page.goto("/pipeline");
  await expect(page.getByText("Synthetic data only")).toBeVisible();
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 deals/)).toBeVisible({ timeout: 180_000 });

  // The funnel starts with everyone and never grows.
  const funnel = page.getByRole("table", { name: "Stage funnel" });
  const counts = async () =>
    (await funnel.getByRole("row").allInnerTexts()).slice(1).map((r) => Number(r.split(/\s+/)[1].replace(/,/g, "")));
  const all = await counts();
  expect(all[0]).toBe(100_000);
  for (let i = 1; i < all.length; i++) expect(all[i]).toBeLessThanOrEqual(all[i - 1]);

  // The three charts and the funnel are drawn.
  await expect(page.getByRole("figure", { name: /Deals that reached each stage/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Days from Proposal to Won/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Stalled deals by stage/ })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(4);

  // Enterprise deals: fewer reach Won, and they wait longer in Proposal. These are the planted facts.
  const medianOf = async () => Number(/Median ([\d.]+) days/.exec(await page.locator("p", { hasText: /deals moved from .* Median/ }).innerText())![1]);
  const smallMedian = await medianOf();
  const segment = page.getByRole("group", { name: "Filter by segment" });
  await segment.getByRole("button", { name: /^enterprise, / }).click();
  await expect(segment.getByRole("button", { name: /^enterprise, / })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Showing (?!100,000 of)[\d,]+ of 100,000 deals/)).toBeVisible();
  const ent = await counts();
  expect(ent[0]).toBeLessThan(all[0]);
  expect(ent[3] / ent[0]).toBeLessThan(all[3] / all[0]);
  await expect.poll(medianOf).toBeGreaterThan(smallMedian);

  // Another stage and a longer stalled threshold change what is shown.
  await page.getByRole("group", { name: "Choose a stage" }).getByRole("button", { name: "Lead to Qualified" }).click();
  await expect(page.getByRole("figure", { name: /Days from Lead to Qualified/ })).toBeVisible();
  // The stalled section says it first, and the outlook repeats the idea, so match the sentence that starts with the count.
  const stalledText = async () => await page.locator("p", { hasText: /^[\d,]+ open deals have not moved for \d+ days or more\.$/ }).innerText();
  const stalledCount = async () => Number(/^([\d,]+) open/.exec(await stalledText())![1].replace(/,/g, ""));
  const at30 = await stalledCount();
  await page.getByRole("group", { name: "Stalled for at least" }).getByRole("button", { name: "60 days" }).click();
  await expect(page.locator("p", { hasText: /^[\d,]+ open deals have not moved for 60 days or more\.$/ })).toBeVisible();
  // The label changes at once and the count a moment later, so wait for the count.
  await expect.poll(stalledCount).toBeLessThan(at30);

  // A deal closed as lost is not stalled. Filtering to lost deals leaves nothing stalled.
  const status = page.getByRole("group", { name: "Filter by status" });
  await expect(status.getByRole("button", { name: /^lost, / })).toBeVisible();
  await status.getByRole("button", { name: /^lost, / }).click();
  await expect(page.getByText(/^0 open deals have not moved for 60 days or more/)).toBeVisible();
  await status.getByRole("button", { name: /^lost, / }).click();

  // The cohort ladder: months of entry, the newest still maturing, and a longer window reaches more.
  const ladder = page.getByRole("table", { name: "Cohort ladder" });
  await expect.poll(async () => (await ladder.getByRole("row").count()) > 6).toBe(true);
  await expect(ladder.getByRole("row").last()).toContainText("still maturing");
  const wonShare = async () => {
    const cells = await ladder.getByRole("row").nth(2).getByRole("cell").allInnerTexts();
    return parseFloat(cells[4]);
  };
  const won60 = await wonShare();

  // Period comparison at 60 days: the two 13 week periods, both fully matured, and the planted change is clear.
  const compare = page.getByRole("table", { name: "Period comparison" });
  await expect(page.getByText(/Earlier: entered 2026-03-04 to 2026-06-03/)).toBeVisible();
  await expect(page.getByText(/Later: entered 2026-06-03 to 2026-09-02/)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "not had the whole window" })).toHaveCount(0);
  const qualified = compare.getByRole("row", { name: /^Qualified/ });
  await expect(qualified).toContainText("yes");
  await expect(qualified).toContainText("+");
  await expect(compare.getByRole("row", { name: /^Won/ })).toBeVisible();
  await expect(page.getByText(/says the two periods differ, not why/)).toBeVisible();

  await page.getByRole("group", { name: "Cohort window" }).getByRole("button", { name: "Within 90 days" }).click();
  // A longer window moves both periods back, so the periods are those that have had 90 days.
  await expect(page.getByText(/Later: entered 2026-05-04 to 2026-08-03/)).toBeVisible();
  await expect.poll(wonShare).toBeGreaterThanOrEqual(won60);

  // Outlook for open deals: a row per stage, expected wins inside their own range, and a stage filter does not move it.
  const outlookTable = page.getByRole("table", { name: "Outlook for open deals" });
  await expect(outlookTable.getByRole("row", { name: /^Lead / })).toBeVisible();
  await expect(outlookTable.getByRole("row", { name: /^Qualified / })).toBeVisible();
  await expect(outlookTable.getByRole("row", { name: /^Proposal / })).toBeVisible();
  const totals = async () => {
    const cells = await outlookTable.getByRole("row", { name: /^All stages/ }).getByRole("cell").allInnerTexts();
    const num = (t: string) => Number(t.replace(/,/g, ""));
    const [low, high] = cells[4].split(" to ").map(num);
    return { active: num(cells[0]), expected: num(cells[3]), low, high };
  };
  const before = await totals();
  expect(before.expected).toBeGreaterThan(0);
  expect(before.low).toBeLessThanOrEqual(before.expected);
  expect(before.high).toBeGreaterThanOrEqual(before.expected);
  await expect(page.getByText(/Active means the deal moved within the last 60 days/)).toBeVisible();
  await expect(page.getByText(/not a forecast/).first()).toBeVisible();
  await page.getByRole("group", { name: "Filter by furthest stage" }).getByRole("button", { name: /^Lead, / }).click();
  await expect(page.getByRole("group", { name: "Filter by furthest stage" }).getByRole("button", { name: /^Lead, / })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(600);
  expect(await totals()).toEqual(before);
  await page.getByRole("group", { name: "Filter by furthest stage" }).getByRole("button", { name: /^Lead, / }).click();
  await page.getByText("How the outlook was worked out").click();
  await expect(page.getByText(/different kind of uncertainty from the range above/)).toBeVisible();

  // Every section can say how its numbers were worked out, from the real values.
  await page.getByText("How the funnel was worked out").click();
  await expect(page.getByText(/went on to reach .*\. [\d,]+ divided by [\d,]+ is/).first()).toBeVisible();
  await page.getByText("How time in stage was worked out").click();
  await expect(page.getByText(/half of these deals took less time than this/)).toBeVisible();
  await page.getByText("How stalled deals were worked out").click();
  await expect(page.getByText(/not won and not lost/)).toBeVisible();
  await page.getByText("How the cohort ladder was worked out").click();
  await expect(page.getByText(/Still maturing: \d+ months?/)).toBeVisible();
  await page.getByText("How the period comparison was worked out").click();
  // One explanation per stage says it, so the first is enough.
  await expect(page.getByText(/Newcombe hybrid score method, runs from/).first()).toBeVisible();

  // The measured time is on the page. The plan's target is 1 second, a guess that this run checks.
  const ms = Number(/Updated in (\d+) ms/.exec(await page.getByText(/Updated in \d+ ms/).innerText())![1]);
  console.log(`browser pipeline update on 100,000 rows: ${ms} ms`);
  expect(ms).toBeLessThan(1000);

  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 deals/)).toBeVisible();
  expect(foreign).toEqual([]);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the pipeline screen fits a phone with the data loaded", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
    await expect(page.getByText(/Showing 100,000 of 100,000 deals/)).toBeVisible({ timeout: 180_000 });
    await page.waitForTimeout(800);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
});
