import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const csv = (text: string, name: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

test("the data check matches two files and finds times the clocks skipped", async ({ page }) => {
  await page.goto("/check");

  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.getByLabel("First file").setInputFiles(csv("email\nann@x.com\nBob@x.com\nann@x.com\ncy@x.com\n", "a.csv"));
  await page.getByLabel("Second file").setInputFiles(csv("email\nbob@x.com\ncy+tag@x.com\ndee@x.com\n", "b.csv"));

  const match = page.getByRole("table", { name: "How the two files line up" });
  await expect(match.getByRole("row", { name: /^In both files 1$/ })).toBeVisible();
  await expect(match.getByRole("row", { name: /^Only in the first 2$/ })).toBeVisible();
  await expect(match.getByRole("row", { name: /^Only in the second 2$/ })).toBeVisible();
  await expect(match.getByRole("row", { name: /^Customers in all 5$/ })).toBeVisible();
  // The possible pair is shown masked, never as a full address, and is not merged.
  await expect(page.getByText("c***@x.com and c***@x.com differ only by a plus tag.")).toBeVisible();
  await expect(page.getByText("cy@x.com")).toHaveCount(0);

  await page.getByLabel("Time zone").selectOption("America/Chicago");
  await page
    .getByLabel("File", { exact: true })
    .setInputFiles(
      csv("id,time\n1,2026-03-07 12:00\n2,2026-03-08 02:30\n3,2026-11-01 01:30\n4,yesterday\n5,2026-03-07T18:00:00Z\n", "t.csv"),
    );
  const times = page.getByRole("table", { name: "5 rows read in America/Chicago" });
  await expect(times.getByRole("row", { name: /^Read as one moment 1$/ })).toBeVisible();
  await expect(times.getByRole("row", { name: /^Time that never happened 1$/ })).toBeVisible();
  await expect(times.getByRole("row", { name: /^Time that happened twice 1$/ })).toBeVisible();
  await expect(page.getByText("Never happened, rows: 2.")).toBeVisible();
  await expect(page.getByText("Happened twice, rows: 3.")).toBeVisible();
  await expect(page.getByText("Not a time, rows: 4.")).toBeVisible();

  // Nothing left the browser.
  expect(requests.filter((u) => !u.startsWith("http://localhost") && !u.startsWith("data:"))).toEqual([]);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal")
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("the data check says so when a file has no email column", async ({ page }) => {
  await page.goto("/check");
  await page.getByLabel("First file").setInputFiles(csv("name\nann\n", "a.csv"));
  await expect(page.getByRole("alert").filter({ hasText: "a.csv has no column named email." })).toBeVisible();
});

test("the data check fits a phone with both reports showing", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/check");
  await page.getByLabel("First file").setInputFiles(csv("email\nann@x.com\nbob@x.com\n", "a.csv"));
  await page.getByLabel("Second file").setInputFiles(csv("email\nbob@x.com\nann+t@x.com\n", "b.csv"));
  await page.getByLabel("File", { exact: true }).setInputFiles(csv("time\n2026-03-08 02:30\n2026-11-01 01:30\n", "t.csv"));
  await expect(page.getByText("Never happened, rows: 1.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
