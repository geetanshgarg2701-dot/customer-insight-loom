import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const animationOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);

test("the Reduce motion switch turns motion off for the tab, and on again, without storing anything", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  const sw = nav.getByRole("button", { name: "Reduce motion" });
  await expect(sw).toHaveAttribute("aria-pressed", "false");
  expect(await animationOf(page, ".hero h1 .line")).toBe("line-up");

  await sw.click();
  await expect(sw).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  expect(await animationOf(page, ".hero h1 .line")).toBe("none");
  expect(await animationOf(page, ".hero-funnel svg")).toBe("none");

  // Nothing is stored, so a reload starts with motion allowed again.
  const stored = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
  expect(stored).toEqual({ local: 0, session: 0, cookies: "" });

  await sw.click();
  await expect(sw).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", /./);
  expect(await animationOf(page, ".hero h1 .line")).toBe("line-up");
});

test("while the journeys load there is a skeleton and a plain line, and the charts follow the switch", async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/journeys");
  // Slow the page down so the loading state lasts long enough to be seen.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  const loading = page.getByRole("status").filter({ hasText: "Loading 100,000 synthetic customers" });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  expect(await animationOf(page, ".skeleton .sk")).toBe("sk-shimmer");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  await expect(loading).toHaveCount(0);

  // A chart follows the switch live.
  const chart = page.getByRole("figure").first();
  await expect(chart).toHaveAttribute("data-motion", "on");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Reduce motion" }).click();
  await expect(chart).toHaveAttribute("data-motion", "off");
});

test("a number that changes slides in, and the text is always the real value", async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  const tiles = page.locator('dl[aria-label="The current selection at a glance"]');
  const customers = tiles.locator("> div").filter({ has: page.locator("dt", { hasText: "Customers shown" }) }).locator("dd");
  await expect(customers).toHaveText("100,000");
  await page.getByRole("button", { name: /^ads, / }).first().click();
  await expect(customers).toHaveText(/^3\d,\d{3}$/);
  expect(await customers.evaluate((el) => getComputedStyle(el).animationName)).toBe("swap-in");
});

test("the result range is drawn as a picture that says the same as the table", async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: /still running/ }).click();
  await expect(page.getByText("Status: running")).toBeVisible({ timeout: 30_000 });
  const results = page.getByRole("region", { name: "Results" });
  const [download] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download demo results file" }).click()]);
  await results.getByLabel("Results CSV").setInputFiles((await download.path())!);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });

  const picture = results.getByRole("img", { name: /percent interval from/ });
  await expect(picture).toBeVisible();
  const sentence = (await picture.getAttribute("aria-label")) ?? "";
  const table = results.getByRole("table", { name: "Readout" });
  const lift = ((await table.getByRole("row", { name: /^Lift/ }).innerText()).match(/[+-]?\d+\.\d+ points/) ?? [""])[0];
  const interval = (await table.getByRole("row", { name: /percent interval/ }).innerText()).replace(/^.*?interval\s*/, "").trim();
  expect(sentence).toContain(`Lift ${lift}`);
  expect(sentence).toContain(`from ${interval.replace(" to ", " to ")}`.replace(/\s+/g, " "));

  // The bar sits where the numbers say: it is entirely on one side of zero exactly when the sentence says so.
  const plot = results.locator(".range-plot");
  const bar = await results.locator(".range-bar").evaluate((el) => ({ left: parseFloat((el as HTMLElement).style.left), width: parseFloat((el as HTMLElement).style.width) }));
  const clearsZero = bar.left > 50 || bar.left + bar.width < 50;
  expect(sentence.includes("includes zero")).toBe(!clearsZero);
  await expect(plot).toHaveAttribute("data-tone", clearsZero ? (bar.left > 50 ? "above" : "below") : "spans");

  // It grows in when motion is allowed, and is simply there when it is not.
  expect(await animationOf(page, ".range-bar")).toBe("range-grow");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Reduce motion" }).click();
  expect(await animationOf(page, ".range-bar")).toBe("none");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
