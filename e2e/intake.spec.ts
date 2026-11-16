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
  await expect(page.getByText("separated by semicolons")).toBeVisible();
  await expect(page.getByRole("table", { name: "Column mapping" })).toHaveCount(0);
});

test("shows a clear message for an empty file", async ({ page }) => {
  await page.goto("/intake");
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("") });
  await expect(page.getByText("The file is empty.")).toBeVisible();
});
