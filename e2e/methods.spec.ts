import { expect, test } from "@playwright/test";
import { METHOD_NOTES, runMethodsReport } from "../src/lib/methods/report";
import { navTo } from "./nav-helper";

test("shows the honesty and redaction counts, the same as the code computes in Node", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const expected = await runMethodsReport();
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const consoleErrors: string[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) foreign.push(req.url());
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/methods");
  await expect(page.getByRole("heading", { name: "Methods" })).toBeVisible();
  await expect(page.getByText(expected.note).first()).toBeVisible();

  const aa = page.getByRole("table", { name: "A/A simulation" });
  await expect(aa).toBeVisible({ timeout: 60_000 });
  await expect(aa).toContainText(`${expected.aa.significantCount} of ${expected.aa.experiments}`);
  await expect(aa).toContainText(`${expected.aa.band.low} to ${expected.aa.band.high}`);

  const planted = page.getByRole("table", { name: "Planted lift simulation" });
  await expect(planted).toContainText(`${expected.planted.coverageCount} of ${expected.planted.experiments}`);
  await expect(planted).toContainText(`${expected.planted.detectedCount} of ${expected.planted.experiments}`);
  await expect(planted).toContainText(String(expected.planted.seed));

  const redaction = page.getByRole("table", { name: "Redaction results" });
  for (const s of expected.redaction.scores) {
    const cells = await redaction.getByRole("row", { name: new RegExp(`^${s.type} `) }).getByRole("cell").allInnerTexts();
    expect(cells).toEqual([String(s.total), String(s.caught), String(s.missed)]);
  }
  const all = await redaction.getByRole("row", { name: /^all / }).getByRole("cell").allInnerTexts();
  expect(all).toEqual([String(expected.redaction.total), String(expected.redaction.caught), String(expected.redaction.missed)]);
  await expect(page.getByRole("list", { name: "Missed items" }).getByRole("listitem")).toHaveCount(expected.redaction.missed);

  await expect(page.getByText(/Names are only partly covered/)).toBeVisible();
  for (const note of METHOD_NOTES) await expect(page.getByText(note.name, { exact: true })).toBeVisible();

  // A reload gives the same numbers, and the page makes no outside request.
  await page.reload();
  await expect(page.getByRole("table", { name: "A/A simulation" })).toContainText(
    `${expected.aa.significantCount} of ${expected.aa.experiments}`,
    { timeout: 60_000 },
  );
  expect(foreign).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("links to the methods page from the main nav", async ({ page }) => {
  await page.goto("/ledger");
  await navTo(page, "Methods");
  await expect(page.getByRole("heading", { name: "Methods" })).toBeVisible();
});
