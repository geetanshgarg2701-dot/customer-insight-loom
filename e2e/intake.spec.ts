import { expect, test, type Page } from "@playwright/test";

const CSV =
  [
    "id,email,customer_name,comment,score",
    "1,jane.doe@example.com,Jane Doe,loved it,5",
    "2,sam.lee@example.com,Sam Lee,too slow,2",
  ].join("\n") + "\n";

async function chooseFile(page: Page, name: string, text: string) {
  await page.goto("/intake");
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(page.getByRole("table", { name: "Column mapping" })).toBeVisible({
    timeout: 30_000,
  });
}

test("blocks identity columns and previews only the allowed ones", async ({ page }) => {
  await chooseFile(page, "survey.csv", CSV);

  for (const blocked of ["email", "customer_name"]) {
    const box = page.getByLabel(`Load column ${blocked}`, { exact: true });
    await expect(box).toBeDisabled();
    await expect(box).not.toBeChecked();
  }
  for (const allowed of ["id", "comment", "score"]) {
    await expect(page.getByLabel(`Load column ${allowed}`, { exact: true })).toBeChecked();
  }

  await page.getByLabel("Name for column comment", { exact: true }).fill("feedback");
  await page.getByRole("button", { name: "Load and preview" }).click();

  const preview = page.getByRole("table", { name: "Preview" });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole("columnheader")).toHaveText(["id", "feedback", "score"]);
  await expect(preview).toContainText("loved it");
  await expect(page.getByText("Loaded 2 rows.")).toBeVisible();

  const body = await page.locator("body").innerText();
  for (const secret of ["jane.doe@example.com", "sam.lee@example.com", "Jane Doe", "Sam Lee"]) {
    expect(body).not.toContain(secret);
  }
});

test("a file with no header row never shows its first row on the page", async ({ page }) => {
  await chooseFile(
    page,
    "no-header.csv",
    "jane.doe@example.com,555-123-4567,great" + String.fromCharCode(10) + "sam.lee@example.com,555-987-6543,slow" + String.fromCharCode(10),
  );

  for (const masked of ["Column 1", "Column 2"]) {
    const box = page.getByLabel(`Load column ${masked}`, { exact: true });
    await expect(box).toBeDisabled();
    await expect(box).not.toBeChecked();
  }
  const body = await page.locator("body").innerText();
  for (const secret of ["jane.doe", "example.com", "555-123-4567"]) {
    expect(body).not.toContain(secret);
  }
});

test("reads the file with self-hosted DuckDB and sends nothing off the origin", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const requests: { url: string; method: string; body: string | null }[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url())) {
      requests.push({ url: req.url(), method: req.method(), body: req.postData() });
    }
  });

  await chooseFile(page, "survey.csv", CSV);
  await page.getByRole("button", { name: "Load and preview" }).click();
  await expect(page.getByRole("table", { name: "Preview" })).toBeVisible({
    timeout: 30_000,
  });

  expect(requests.some((r) => /\/duckdb\/duckdb-.*\.worker\.js$/.test(r.url))).toBe(true);
  expect(requests.filter((r) => new URL(r.url).origin !== origin)).toEqual([]);
  // No request after the file was chosen carries the file contents.
  expect(requests.filter((r) => r.method !== "GET" && r.method !== "HEAD")).toEqual([]);
  for (const r of requests) expect(r.body ?? "").not.toContain("jane.doe");
});

test("shows a clear message for a semicolon separated file", async ({ page }) => {
  await page.goto("/intake");
  await page.getByLabel("CSV file").setInputFiles({
    name: "semi.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id;comment\n1;great\n2;ok\n"),
  });
  await expect(page.getByText("separated by semicolons")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("table", { name: "Column mapping" })).toHaveCount(0);
});

test("shows a clear message for an empty file", async ({ page }) => {
  await page.goto("/intake");
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("") });
  await expect(page.getByText("The file is empty.")).toBeVisible({ timeout: 30_000 });
});

const MESSY = [
  "id,amount,order_date,note,status",
  "1,10.5,2026-07-01,ok,done",
  "2,abc,2026-07-02,N/A,done",
  "3,7,2026-02-30,,done",
  "3,7,2026-02-30,,done",
  "4,8,2026-07-04, fine,done",
  "5,12,2026-07-05,fine,done",
  "9,1",
].join("\n") + "\n";

test("a loaded file gets a health score and a cleaning report with row numbers, and the report shows no cell value", async ({ page }) => {
  test.setTimeout(120_000);
  await chooseFile(page, "orders.csv", MESSY);
  await page.getByRole("button", { name: "Load and preview" }).click();
  const health = page.getByRole("region", { name: "Data health" });
  await expect(health).toBeVisible({ timeout: 60_000 });

  // The score is the one the unit test works out: 6 loaded rows of 7, one repeat, and the flaws named below.
  await expect(health.getByRole("status")).toContainText(/\d+ out of 100, (Good|Fair|Poor)/);
  await expect(health.getByRole("status")).toContainText("6 rows and 5 columns were checked.");

  const report = health.getByRole("list");
  await expect(report).toContainText('The column "amount" mostly holds numbers, but 1 cell is not a number.');
  await expect(report).toContainText('The column "order_date" mostly holds dates, but 2 cells are not a valid date.');
  await expect(report).toContainText("First rows to check: 3, 4, counting the first row after the header as row 1.");
  await expect(report).toContainText("1 row repeats an earlier row exactly.");
  await expect(report).toContainText("1 row was skipped because it had too few or too many fields.");
  await expect(report).toContainText('Every filled cell in the column "status" holds the same value.');
  await expect(report.getByText("Fix first.").first()).toBeVisible();

  // The cleaning report names columns, counts and rows. Values only appear in the preview, which existed before.
  const reportText = await report.innerText();
  for (const value of ["abc", "2026-02-30", "10.5"]) expect(reportText).not.toContain(value);

  // The score's working is there for anyone who wants to check it.
  await health.getByText("How the score is made").click();
  const parts = health.getByRole("table", { name: "How the score is made" });
  await expect(parts.getByRole("row", { name: /^Completeness/ })).toBeVisible();
  await expect(parts.getByRole("row", { name: /^Row integrity/ })).toContainText("86 percent");
  await expect(health.getByText(/cannot tell whether a value is right/)).toBeVisible();
});

test("the health section has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseFile(page, "orders.csv", MESSY);
  await page.getByRole("button", { name: "Load and preview" }).click();
  await expect(page.getByRole("region", { name: "Data health" })).toBeVisible({ timeout: 60_000 });
  await page.getByText("How the score is made").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
