import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const n = (v: number) => v.toLocaleString("en-US");

test("a shared journeys link opens the same view in a fresh page, with the data loaded for the reader", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });

  // Choose a view: the new segment, the Search detour as the anchor, a 30 day window and the Cart step.
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / }).click();
  const searchers = rows.filter((r) => r.segment === "new" && r.path.includes("Search")).length;
  await page.getByRole("region", { name: "Around one event" }).getByRole("combobox").selectOption({ label: `Search, ${n(searchers)} customers` });
  await page.getByRole("region", { name: "Time between steps" }).getByRole("button", { name: "30 days" }).click();
  await page.getByRole("region", { name: "Behind a step" }).getByRole("button", { name: "Product" }).click();

  const link = await page.getByRole("textbox", { name: "Link to this view" }).inputValue();
  expect(link).toMatch(/#v=1&/);
  expect(link).toContain("f.segment=new");
  expect(link).toContain("an=Search");
  expect(link).toContain("w=720");
  expect(link).toContain("b=1");
  // Only plain choices are in the link, never data or a name.
  expect(link.split("#")[1]).toMatch(/^[A-Za-z0-9._,=&-]+$/);

  // A second person opens it in a fresh browser context, with nothing stored from the first.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2.getByText(/Opened from a shared link\./)).toBeVisible({ timeout: 180_000 });
  const fresh = rows.filter((r) => r.segment === "new");
  await expect(p2.getByText(new RegExp(`Showing ${n(fresh.length)} of 100,000 customers`))).toBeVisible({ timeout: 180_000 });
  await expect(p2.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / })).toHaveAttribute("aria-pressed", "true");
  await expect(p2.getByRole("region", { name: "Time between steps" }).getByRole("table").locator("caption")).toHaveText(
    "30 day window from entry, data cutoff 2026-10-15",
    { timeout: 60_000 },
  );
  const atProduct = fresh.filter((r) => r.steps[1] !== null).length;
  await expect(p2.getByRole("region", { name: "Behind a step" }).getByText(new RegExp(`^${n(atProduct)} people reached Product\.`))).toBeVisible({ timeout: 60_000 });
  await expect(p2.getByRole("region", { name: "Around one event" }).getByText(/did Search\./).first()).toBeVisible();
  await other.close();
});

test("a link with unknown or hostile parts opens safely and says what it ignored", async ({ page }) => {
  test.setTimeout(240_000);
  const messages: string[] = [];
  page.on("pageerror", (e) => messages.push(e.message));
  await page.goto("/journeys#v=1&f.segment=new,hacker&f.channel=%3Cscript%3Ealert(1)%3C/script%3E&w=999&cmp=segment.new.%27%20OR%20%271%27=%271");
  await expect(page.getByText(/Opened from a shared link\./)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/were not recognized and were ignored: .*f\.channel.*f\.segment|were not recognized and were ignored: .*cmp/)).toBeVisible();
  // The one valid value was used, and nothing else was.
  await expect(page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  expect(await page.locator("body").innerHTML()).not.toContain("<script>alert");
  expect(messages).toEqual([]);
});

test("a link of another version, or garbage, is left alone and the page works as usual", async ({ page }) => {
  await page.goto("/journeys#v=2&w=168");
  await expect(page.getByRole("button", { name: "Load synthetic journeys" })).toBeVisible();
  await expect(page.getByText(/Opened from a shared link\./)).toHaveCount(0);
  await page.goto("/journeys#not-a-link");
  await expect(page.getByRole("button", { name: "Load synthetic journeys" })).toBeVisible();
});

test("the share box has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByRole("region", { name: "Share this view" })).toBeVisible({ timeout: 180_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("a shared pipeline link restores the filters, the records stage and the scrubber date", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { syntheticPipeline } = await import("../src/lib/demo/pipeline");
  const deals = syntheticPipeline(100_000, 21);
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 deals/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^enterprise, / }).click();
  await page.getByRole("region", { name: "Records behind a stage" }).getByRole("group", { name: "Stage to list" }).getByRole("button", { name: "Qualified" }).click();
  const section = page.getByRole("region", { name: "Pipeline over time" });
  for (let i = 0; i < 10; i++) await section.getByRole("button", { name: "Previous week" }).click();

  const link = await page.getByRole("textbox", { name: "Link to this view" }).inputValue();
  expect(link).toContain("f.segment=enterprise");
  expect(link).toContain("rs=1");
  const date = /sd=(\d{4}-\d{2}-\d{2})/.exec(link)![1];
  expect(link.split("#")[1]).toMatch(/^[A-Za-z0-9._,=&-]+$/);

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2.getByText(/Opened from a shared link\./)).toBeVisible({ timeout: 180_000 });
  const ent = deals.filter((d) => d.segment === "enterprise");
  await expect(p2.getByText(new RegExp(`Showing ${ent.length.toLocaleString("en-US")} of 100,000 deals`))).toBeVisible({ timeout: 180_000 });
  const qualified = ent.filter((d) => d.entered[1] !== null).length;
  await expect(
    p2.getByRole("region", { name: "Records behind a stage" }).getByRole("table", { name: "Records behind a stage" }).locator("caption"),
  ).toHaveText(`Deals 1 to 20 of ${qualified.toLocaleString("en-US")}`, { timeout: 60_000 });
  await expect(p2.getByRole("region", { name: "Pipeline over time" }).getByText(new RegExp(`^On ${date},`))).toBeVisible({ timeout: 60_000 });
  await other.close();
});

test("a pipeline link with unknown parts opens safely and says what it ignored", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/pipeline#v=1&f.segment=huge,smb&sd=2026-02-30&rw=all");
  await expect(page.getByText(/Opened from a shared link\./)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/were not recognized and were ignored: .*(f\.segment|rw|sd)/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^smb, / })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
});
