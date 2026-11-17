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
  await expect(page.locator("canvas")).toHaveCount(3);

  // Enterprise deals: fewer reach Won, and they wait longer in Proposal. These are the planted facts.
  const medianOf = async () => Number(/Median ([\d.]+) days/.exec(await page.getByText(/deals moved from/).innerText())![1]);
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
  const stalledText = async () => (await page.getByText(/open deals have not moved for/).innerText());
  const stalledCount = async () => Number(/^([\d,]+) open/.exec(await stalledText())![1].replace(/,/g, ""));
  const at30 = await stalledCount();
  await page.getByRole("group", { name: "Stalled for at least" }).getByRole("button", { name: "60 days" }).click();
  await expect(page.getByText(/have not moved for 60 days or more/)).toBeVisible();
  // The label changes at once and the count a moment later, so wait for the count.
  await expect.poll(stalledCount).toBeLessThan(at30);

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
