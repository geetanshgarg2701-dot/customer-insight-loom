import { expect, test } from "@playwright/test";

test("linked charts filter each other on 100,000 synthetic journeys, and the update is timed", async ({
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

  await page.goto("/journeys");
  await expect(page.getByText("Synthetic data only")).toBeVisible();
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });

  // Three bar charts and the flow chart are drawn.
  await expect(page.getByRole("figure", { name: /Channel, customers per value/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Segment, customers per value/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Furthest step reached, customers per value/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Flow of customers between steps/ })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(7);

  // Top paths: every customer is in exactly one row, the rare paths are merged and labeled, and detours show up.
  const pathsTable = page.getByRole("table", { name: "Top paths" });
  await expect(pathsTable).toContainText("Search");
  await expect(pathsTable).toContainText("Support");
  const customerSum = async () => {
    const rows = await pathsTable.getByRole("row").allInnerTexts();
    return rows
      .filter((r) => !/^Path|^All customers/.test(r))
      .reduce((n, r) => n + Number(r.split(/\t/)[1].replace(/,/g, "")), 0);
  };
  expect(await customerSum()).toBe(100_000);
  await expect(pathsTable.getByRole("row", { name: /^All customers shown 100,000/ })).toBeVisible();
  await page.getByRole("group", { name: "Rarity threshold" }).getByRole("button", { name: "Merge paths under 5 percent" }).click();
  await expect(pathsTable).toContainText("Other paths");
  await expect.poll(customerSum).toBe(100_000);

  // What if: one step is changed, and the answer says what it assumes and that it is not a forecast.
  await page.getByRole("group", { name: "Step to change" }).getByRole("button", { name: "Product to Cart" }).click();
  await page.getByRole("group", { name: "Change in percentage points" }).getByRole("button", { name: "+10 points" }).click();
  await expect(page.getByText(/more people would reach Purchase/)).toBeVisible();
  // The what if paragraph and its explanation both say it, so check the paragraph.
  await expect(page.locator("p", { hasText: /^This assumes the people gained behave like everyone/ })).toBeVisible();
  await page.getByRole("group", { name: "Change in percentage points" }).getByRole("button", { name: "-10 points" }).click();
  await expect(page.getByText(/fewer people would reach Purchase/)).toBeVisible();

  await page.getByText("How top paths were worked out").click();
  await expect(page.getByText(/customers took exactly this route, detours included/).first()).toBeVisible();
  await page.getByText("How the what if was worked out").click();
  await expect(page.getByText(/Carried to Purchase: [\d,]+ people, [\d,]+ (more|fewer)/)).toBeVisible();

  // Choosing the segment "new" with the keyboard route narrows every other chart and the flow.
  const flow = page.getByRole("table", { name: "Flow between steps" });
  const before = await flow.getByRole("row").count();
  const segment = page.getByRole("group", { name: "Filter by segment" });
  await segment.getByRole("button", { name: /^new, / }).click();
  await expect(segment.getByRole("button", { name: /^new, / })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Showing (?!100,000 of)[\d,]+ of 100,000 customers/)).toBeVisible();

  // The channel chart narrowed to the new segment, so its buttons add up to fewer than 100,000.
  const channel = page.getByRole("group", { name: "Filter by channel" });
  const labels = await channel.getByRole("button").allInnerTexts();
  const total = labels.reduce((n, t) => n + Number(t.split(", ")[1].replace(/,/g, "")), 0);
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(100_000);
  expect(await flow.getByRole("row").count()).toBeLessThanOrEqual(before);

  // The measured time is on the page. The plan's target is 1 second, a guess that this run checks.
  const text = await page.getByText(/Updated in \d+ ms/).innerText();
  const ms = Number(/Updated in (\d+) ms/.exec(text)![1]);
  console.log(`browser cross filter update on 100,000 rows: ${ms} ms`);
  expect(ms).toBeLessThan(1000);

  // Clearing the selection brings everyone back.
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible();

  expect(foreign).toEqual([]);
});
