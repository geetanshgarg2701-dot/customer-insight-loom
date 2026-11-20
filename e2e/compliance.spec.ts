import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the email check approves the synthetic example, and blocks when a law rule fails or a statement is unticked", async ({ page }) => {
  await page.goto("/compliance");
  const status = page.getByRole("status");
  await expect(status).toContainText("Blocked.");

  await page.getByRole("button", { name: "Fill with a synthetic example" }).click();
  await expect(status).toHaveText("Approved to send.");
  const table = page.getByRole("table", { name: "Each rule, its result and its source" });
  const address = table.getByRole("row", { name: /^Physical postal address/ });
  await expect(address).toContainText("Pass");
  await expect(address).toContainText("FTC, CAN-SPAM Act: A Compliance Guide for Business");
  await expect(address).toContainText("Checked 2026-11-19");
  await expect(table.getByRole("row", { name: /^What a violation costs/ })).toContainText("53,088 dollars");

  // Take the postal address out of the body.
  const body = page.getByLabel("Body");
  await body.fill("Advertisement. Orders over 50 dollars ship free. Unsubscribe any time.");
  await expect(status).toHaveText("Blocked. 1 rule needs attention.");
  await expect(address).toContainText("Fail");
  await expect(address).toContainText("Blocks sending.");
  await body.fill("Advertisement. Shop Example, PO Box 4471, Springfield. Unsubscribe any time.");
  await expect(status).toHaveText("Approved to send.");

  // A statement only the person can make.
  await page.getByLabel("The email clearly says it is an advertisement.").uncheck();
  await expect(status).toContainText("Blocked.");
  await expect(table.getByRole("row", { name: /^Identified as an ad/ })).toContainText("Needs your answer");
  await page.getByLabel("The email clearly says it is an advertisement.").check();

  // Below bulk volume, one click is not required. At bulk volume, missing headers block.
  await page.getByLabel("List-Unsubscribe-Post header").fill("");
  await expect(status).toContainText("Blocked.");
  await page.getByLabel("Messages a day to Gmail accounts").fill("4999");
  await expect(status).toHaveText("Approved to send.");
  await expect(table.getByRole("row", { name: /^One click unsubscribe/ })).toContainText("Does not apply");

  // Authentication is a checklist and never blocks, and an EU or Canadian audience gets a warning.
  await page.getByLabel("SPF or DKIM is set up for the sending domain.").uncheck();
  await page.getByLabel("Both SPF and DKIM are set up.").uncheck();
  await expect(status).toHaveText("Approved to send.");
  await page.getByLabel("Some recipients are in the EU or Canada").check();
  await expect(table.getByRole("row", { name: /^EU and Canadian recipients/ })).toContainText("GDPR and CASL checks are not built");

  // A bad number is named and does not crash the check.
  await page.getByLabel("Spam rate in percent, from Postmaster Tools").fill("abc");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Some numbers are not valid.");
});

test("the email check has no axe violations and fits a phone with the example filled in", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/compliance");
  await page.getByRole("button", { name: "Fill with a synthetic example" }).click();
  await expect(page.getByRole("status")).toHaveText("Approved to send.");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
