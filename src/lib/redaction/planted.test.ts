import { describe, expect, it } from "vitest";
import { redact } from "./redact";
import {
  ITEMS_PER_TYPE,
  PLANTED_TYPES,
  evaluatePlanted,
  generatePlanted,
} from "./testdata/planted";

describe("planted set", () => {
  const items = generatePlanted();

  it("has 200 items, 50 per type", () => {
    expect(items).toHaveLength(200);
    for (const type of PLANTED_TYPES) {
      expect(items.filter((i) => i.type === type)).toHaveLength(ITEMS_PER_TYPE);
    }
  });

  it("is identical on every run", () => {
    expect(generatePlanted()).toEqual(items);
  });

  it("contains each planted value exactly once in its own text", () => {
    for (const item of items) {
      const first = item.text.indexOf(item.value);
      expect(first, item.id).toBeGreaterThanOrEqual(0);
      expect(item.text.indexOf(item.value, first + 1), item.id).toBe(-1);
    }
  });

  it("uses only fake data: reserved domains, 555-01xx or reserved intl ranges", () => {
    for (const item of items.filter((i) => i.type === "email" && i.variant !== "obfuscated-at-dot")) {
      expect(item.value.toLowerCase(), item.id).toMatch(/@([a-z0-9-]+\.)*example\.(com|org|net)$/);
    }
    for (const item of items.filter((i) => i.type === "phone" && i.variant.match(/dashes|parens|dots|spaces|plus1|bare|extension/))) {
      expect(item.value, item.id).toMatch(/555\D?01\d\d/);
    }
  });

  it("every planted card number passes the Luhn test", async () => {
    const { luhnValid } = await import("./luhn");
    for (const item of items.filter((i) => i.type === "card")) {
      expect(luhnValid(item.value.replace(/[ -]/g, "")), item.id).toBe(true);
    }
  });

  it("reports caught and missed counts per type (real numbers, no pass mark)", () => {
    const { scores, missed } = evaluatePlanted(items, redact);
    for (const s of scores) {
      expect(s.caught + s.missed).toBe(s.total);
      expect(s.total).toBe(ITEMS_PER_TYPE);
    }
    expect(missed).toHaveLength(scores.reduce((n, s) => n + s.missed, 0));

    const lines = [
      "",
      "Planted set result (caught means a finding of the right type covers the whole value)",
      "type     total  caught  missed",
      ...scores.map(
        (s) =>
          `${s.type.padEnd(8)} ${String(s.total).padStart(5)}  ${String(s.caught).padStart(6)}  ${String(s.missed).padStart(6)}`,
      ),
      `all      ${String(scores.reduce((n, s) => n + s.total, 0)).padStart(5)}  ${String(scores.reduce((n, s) => n + s.caught, 0)).padStart(6)}  ${String(scores.reduce((n, s) => n + s.missed, 0)).padStart(6)}`,
      "",
      "Missed items:",
      ...missed.map((m) => `  ${m.id} [${m.variant}] (${m.reason}) ${JSON.stringify(m.value)}`),
      "",
    ];
    console.log(lines.join("\n"));
  });
});
