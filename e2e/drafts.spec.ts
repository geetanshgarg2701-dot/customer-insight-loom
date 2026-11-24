import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { navTo } from "./nav-helper";

test("a draft is built in the named framework, blocked until the address and statements are done, then approved in the sandbox and sent nowhere", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) foreign.push(req.url());
  });

  await page.goto("/drafts");
  await expect(page.getByText("Built by the app from a template and your inputs. No language model wrote it. A person must approve it.")).toBeVisible();

  // An empty brief is refused with the reason, and no draft appears.
  await page.getByRole("button", { name: "Make the draft" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("The brand must be 1 to 80 characters.");
  await expect(page.getByRole("heading", { name: "The draft, and the email check" })).toHaveCount(0);

  await page.getByLabel("Segment").selectOption("new");
  await page.getByLabel("Brand name").fill("Shop Example");
  await page.getByLabel(/^The offer/).fill("free shipping on orders over 50 dollars");
  await page.getByLabel("Call to action").fill("Shop the offer");
  await page.getByRole("button", { name: "Make the draft" }).click();

  const section = page.getByRole("region", { name: "The draft, and the email check" });
  await expect(section.getByText("Built in the PAS order: Problem, Agitate, Solution, Action.")).toBeVisible();
  await expect(section.getByLabel("Subject line", { exact: true })).toHaveValue("A simpler answer on shipping");
  const body = section.getByLabel(/^Body/);
  await expect(body).toHaveValue(/^Advertisement from Shop Example\./);
  await expect(body).toHaveValue(/If you are new here, welcome\./);
  await expect(body).toHaveValue(/Shop Example now offers free shipping on orders over 50 dollars\./);
  await expect(body).toHaveValue(/\[Your postal address\]/);

  // The placeholder fails the postal address rule, so approval is closed.
  const approve = section.getByRole("button", { name: "Approve in the sandbox" });
  await expect(approve).toBeDisabled();
  await expect(section.getByRole("row", { name: /^Physical postal address/ })).toContainText("Fail");

  // A real address clears that rule, and the statements only a person can make clear the rest.
  await body.fill((await body.inputValue()).replace("[Your postal address]", "Shop Example, 100 Harbor Street, Springfield"));
  await expect(section.getByRole("row", { name: /^Physical postal address/ })).toContainText("Pass");
  await expect(approve).toBeDisabled();
  await section.getByLabel("From address", { exact: true }).fill("news@shop.example.com");
  await section.getByLabel("Days to process an unsubscribe, counting every day").fill("1");
  for (const label of [
    "The subject line matches what the email is.",
    "The From name and routing information identify who is sending.",
    "The email clearly says it is an advertisement.",
    "The opt out will keep working for at least 30 days after sending.",
    "The audience leaves out opted out people, people without consent, and holdout controls.",
  ]) {
    await section.getByLabel(label).check();
  }
  await expect(section.getByRole("status").filter({ hasText: "Approved to send." })).toBeVisible();
  await expect(approve).toBeEnabled();

  // Approval is recorded in the sandbox log, with the subject only, and the page says nothing was sent.
  await approve.click();
  await expect(section.getByText("Approved in the sandbox. Nothing was sent, and nothing leaves this tab.")).toBeVisible();
  const log = page.getByRole("table", { name: "Sandbox log" });
  await expect(log.getByRole("row", { name: /PAS.*Shipping costs too much.*new.*A simpler answer on shipping.*Approved, not sent/ })).toBeVisible();
  expect(await log.innerText()).not.toContain("Harbor");
  expect(foreign).toEqual([]);

  // The draft becomes a ledger entry that carries the framework and the complaint.
  await section.getByRole("button", { name: "Make a draft ledger entry from this" }).click();
  // The first use of the in-browser database starts it, which takes about 1.4 seconds alone and far longer when the whole
  // suite is running, so this one wait is longer than the 5 second default.
  await expect(section.getByText(/^Made a draft ledger entry\./)).toBeVisible({ timeout: 45_000 });
  await navTo(page, "Ledger");
  await page.getByRole("link", { name: "Email: A simpler answer on shipping" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Email: A simpler answer on shipping" })).toBeVisible();
  await expect(page.getByText("Framework tag: PAS")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true }).locator("option:checked")).toHaveText("Shipping costs too much");
  await expect(page.getByText(/^Hypothesis: A PAS email about free shipping on orders over 50 dollars, sent to new customers who raised Shipping costs too much/)).toBeVisible();
});

test("each framework draws its own parts, and the page has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/drafts");
  await page.getByLabel("Brand name").fill("Shop Example");
  await page.getByLabel(/^The offer/).fill("a faster checkout");
  await page.getByLabel("Call to action").fill("Try it");
  for (const [framework, parts] of [
    ["FAB", "Feature, Advantage, Benefit, Action"],
    ["AIDA", "Attention, Interest, Desire, Action"],
  ] as const) {
    await page.getByLabel("Framework").selectOption(framework);
    await page.getByRole("button", { name: "Make the draft" }).click();
    await expect(page.getByText(`Built in the ${framework} order: ${parts}.`)).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
