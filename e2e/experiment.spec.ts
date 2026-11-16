import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const N = 4000;

/** An audience file with an email column, which intake blocks and assignment may read to hash. */
function audienceCsv(): string {
  const rows = ["customer_email,first_name,segment"];
  for (let i = 0; i < N; i++) rows.push(`person${i}@example.com,Name${i},${i % 3}`);
  return rows.join("\n") + "\n";
}

async function createEntry(page: Page, title: string) {
  await page.goto("/ledger");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Hypothesis").fill("An offer lifts 30 day repurchase.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
}

test("runs an experiment from draft to a recorded readout, and exports and imports the ledger", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const posts: string[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) foreign.push(req.url());
    if (req.method() !== "GET" && req.method() !== "HEAD") posts.push(req.method() + " " + req.url());
  });

  await createEntry(page, "Win back offer");

  // Design and power check
  const design = page.getByRole("region", { name: "Design and power check" });
  await design.getByLabel("Baseline conversion rate, percent").fill("30");
  await design.getByLabel("Smallest lift to detect, percentage points").fill("15");
  await design.getByLabel("Treatment share, percent").fill("50");
  await design.getByLabel("People available").fill(String(N));
  await design.getByRole("button", { name: "Run power check" }).click();
  await expect(design.getByText("Power check passed")).toBeVisible();
  await design.getByRole("button", { name: "Register entry" }).click();
  await expect(page.getByText("Status: registered")).toBeVisible();

  // Assignment, from a file whose email column is read only to hash it
  const assign = page.getByRole("region", { name: "Assignment" });
  await assign.getByLabel("Audience CSV").setInputFiles({
    name: "audience.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(audienceCsv()),
  });
  await expect(assign.getByLabel("Email column")).toHaveValue("0", { timeout: 30_000 });
  await assign.getByRole("button", { name: "Assign audience" }).click();
  await expect(assign.getByText(`Assigned ${N} people`)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    assign.getByRole("button", { name: "Download assignment file" }).click(),
  ]);
  const assignmentFile = fs.readFileSync((await download.path())!, "utf8");
  expect(assignmentFile.split("\r\n")[0]).toBe(`email,group,entry_id`);
  expect(assignmentFile.split("\r\n").filter(Boolean)).toHaveLength(N + 1);

  // The page never shows an email address.
  expect(await page.locator("body").innerText()).not.toContain("@example.com");

  await page.getByRole("button", { name: "Mark as launched" }).click();
  await expect(page.getByText("Status: running")).toBeVisible();
  await expect(page.getByText("Type: Confirmatory")).toBeVisible();

  // Results: the user's send tool returns the file with a converted column.
  const lines = assignmentFile.split("\r\n").filter(Boolean);
  const results = [
    `${lines[0]},converted`,
    ...lines.slice(1).map((line, i) => {
      const treated = line.split(",")[1] === "treatment";
      const converted = treated ? i % 100 < 45 : i % 100 < 30;
      return `${line},${converted ? 1 : 0}`;
    }),
  ].join("\n");
  const readout = page.getByRole("region", { name: "Results" });
  await readout.getByLabel("Results CSV").setInputFiles({
    name: "results.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(results + "\n"),
  });
  await expect(readout.getByLabel("Email column")).toHaveValue("0", { timeout: 30_000 });
  await expect(readout.getByLabel("Group column")).toHaveValue("1");
  await expect(readout.getByLabel("Converted column")).toHaveValue("3");
  await readout.getByRole("button", { name: "Verify and read out" }).click();
  await expect(readout.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });
  await expect(readout.getByRole("table", { name: "Verification" })).toContainText(String(N));
  await expect(readout.getByText(/Newcombe/)).toBeVisible();
  await expect(readout.getByText(/Significant: yes/)).toBeVisible();
  await readout.getByRole("button", { name: "Record result in ledger" }).click();
  await expect(page.getByText("Status: readable")).toBeVisible();

  // The ledger list keeps its state across client side navigation.
  await page.getByRole("link", { name: "Ledger", exact: true }).click();
  const list = page.getByRole("table", { name: "Ledger entries" });
  await expect(list).toContainText("Win back offer");
  await expect(list).toContainText("readable");
  await expect(list).toContainText("Confirmatory");

  // Export has no email address in it.
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export ledger" }).click(),
  ]);
  const exportPath = (await exported.path())!;
  const exportText = fs.readFileSync(exportPath, "utf8");
  expect(JSON.parse(exportText).entries).toHaveLength(1);
  expect(exportText).not.toContain("@");

  // A fresh page load starts an empty ledger. Import brings the entry back, marked as imported.
  await page.goto("/ledger");
  await expect(page.getByText("No entries yet")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Import ledger file").setInputFiles(exportPath);
  await expect(page.getByText("Imported 1 entry.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("table", { name: "Ledger entries" })).toContainText("Imported");
  await expect(page.getByRole("table", { name: "Ledger entries" })).toContainText("times not verified");

  // A second import is refused because the ledger is no longer empty.
  await page.getByLabel("Import ledger file").setInputFiles(exportPath);
  await expect(page.getByText(/already has entries/)).toBeVisible();

  expect(foreign).toEqual([]);
  expect(posts).toEqual([]);
});

test("blocks registration when the audience is too small", async ({ page }) => {
  await createEntry(page, "Small test");
  const design = page.getByRole("region", { name: "Design and power check" });
  await design.getByLabel("People available").fill("200");
  await design.getByRole("button", { name: "Run power check" }).click();
  await expect(design.getByText("Power check failed")).toBeVisible();
  await expect(design.getByRole("button", { name: "Register entry" })).toBeDisabled();
  await expect(design.getByText(/exploratory/)).toBeVisible();
});

test("tells the user when an upload has no email column to match", async ({ page }) => {
  await createEntry(page, "No email");
  const design = page.getByRole("region", { name: "Design and power check" });
  await design.getByLabel("Baseline conversion rate, percent").fill("30");
  await design.getByLabel("Smallest lift to detect, percentage points").fill("15");
  await design.getByLabel("People available").fill("4000");
  await design.getByLabel("Treatment share, percent").fill("50");
  await design.getByRole("button", { name: "Run power check" }).click();
  await design.getByRole("button", { name: "Register entry" }).click();
  const assign = page.getByRole("region", { name: "Assignment" });
  await assign.getByLabel("Audience CSV").setInputFiles({
    name: "ids.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("score,segment\n1,a\n2,b\n"),
  });
  await expect(assign.getByLabel("Email column")).toBeVisible({ timeout: 30_000 });
  await expect(assign.getByRole("button", { name: "Assign audience" })).toBeDisabled();
});

test("rebuilds the same assignment file in a new session, and never leaks it to another entry", async ({ page }) => {
  test.setTimeout(180_000);
  await createEntry(page, "Rebuild check");
  const design = page.getByRole("region", { name: "Design and power check" });
  await design.getByLabel("Baseline conversion rate, percent").fill("30");
  await design.getByLabel("Smallest lift to detect, percentage points").fill("15");
  await design.getByLabel("Treatment share, percent").fill("50");
  await design.getByLabel("People available").fill(String(N));
  await design.getByRole("button", { name: "Run power check" }).click();
  await design.getByRole("button", { name: "Register entry" }).click();
  await expect(page.getByText("Status: registered")).toBeVisible();

  const assign = page.getByRole("region", { name: "Assignment" });
  const audience = { name: "audience.csv", mimeType: "text/csv", buffer: Buffer.from(audienceCsv()) };
  await assign.getByLabel("Audience CSV").setInputFiles(audience);
  await expect(assign.getByLabel("Email column")).toHaveValue("0", { timeout: 30_000 });
  await assign.getByRole("button", { name: "Assign audience" }).click();
  await expect(assign.getByText(`Assigned ${N} people`)).toBeVisible({ timeout: 60_000 });
  const [first] = await Promise.all([
    page.waitForEvent("download"),
    assign.getByRole("button", { name: "Download assignment file" }).click(),
  ]);
  const original = fs.readFileSync((await first.path())!, "utf8");

  // A second entry must not inherit the first entry's assignment or its download.
  await page.getByRole("link", { name: "Ledger", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Other entry");
  await page.getByLabel("Hypothesis").fill("H");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("link", { name: "Other entry" }).click();
  await expect(page.getByRole("heading", { name: "Other entry" })).toBeVisible({ timeout: 30_000 });
  await expect(assign.getByRole("button", { name: "Download assignment file" })).toHaveCount(0);
  await expect(assign.getByText(/Assigned \d+ people/)).toHaveCount(0);

  // Export, then reload. A new session starts with an empty ledger, so the download is gone.
  await page.getByRole("link", { name: "Ledger", exact: true }).click();
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export ledger" }).click(),
  ]);
  const exportPath = (await exported.path())!;
  await page.goto("/ledger");
  await expect(page.getByText("No entries yet")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Import ledger file").setInputFiles(exportPath);
  await expect(page.getByText("Imported 2 entries.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Rebuild check" }).click();
  await expect(assign.getByText(`${N} people were assigned earlier`)).toBeVisible({ timeout: 30_000 });
  await expect(assign.getByRole("button", { name: "Download assignment file" })).toHaveCount(0);

  await assign.getByLabel("Audience CSV").setInputFiles(audience);
  await expect(assign.getByLabel("Email column")).toHaveValue("0", { timeout: 30_000 });
  await assign.getByRole("button", { name: "Rebuild assignment file" }).click();
  await expect(assign.getByText(`Rebuilt the file for ${N} of ${N} assigned people.`)).toBeVisible({ timeout: 60_000 });
  const [second] = await Promise.all([
    page.waitForEvent("download"),
    assign.getByRole("button", { name: "Download assignment file" }).click(),
  ]);
  expect(fs.readFileSync((await second.path())!, "utf8")).toBe(original);
  expect(await page.locator("body").innerText()).not.toContain("@example.com");
});
