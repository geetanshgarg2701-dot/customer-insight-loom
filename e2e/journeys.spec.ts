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
  await expect(page.locator("canvas")).toHaveCount(4);

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

test("the style switcher changes the page, and the choice is remembered in this browser", async ({ page }) => {
  await page.goto("/journeys");
  const board = page.locator(".board");
  await expect(board).toHaveAttribute("data-style", "editorial");

  await page.getByRole("radio", { name: /Dense analytics/ }).check();
  await expect(board).toHaveAttribute("data-style", "dense");
  // The page really changes: the board background is dark in the dense direction.
  const bg = await board.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(15, 20, 25)");

  await page.getByRole("radio", { name: /Friendly/ }).check();
  await expect(board).toHaveAttribute("data-style", "friendly");

  await page.reload();
  await expect(page.getByRole("radio", { name: /Friendly/ })).toBeChecked();
  await expect(page.locator(".board")).toHaveAttribute("data-style", "friendly");
});
