import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { createCommentsBoard, QUOTE_PAGE, type CommentsBoard } from "./board";
import { syntheticComments } from "./comments";
import { prepareComments } from "./prepare";

const journeys = syntheticJourneys(5_000, 11);
const comments = syntheticComments(journeys, 1_000, 17);
const prepared = prepareComments(comments);

describe("createCommentsBoard", () => {
  let e: SqlEngine;
  let board: CommentsBoard;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    board = await createCommentsBoard(e, journeys, comments);
  });
  afterAll(async () => board.close());

  it("reports the same kept, withheld and scorecard as the redaction step", () => {
    expect(board.kept).toBe(prepared.rows.length);
    expect(board.withheld).toBe(prepared.withheld);
    expect(board.scorecard).toEqual(prepared.scorecard);
  });

  it("pages through the redacted quotes of one pain, in customer order, with the customer's journey facts", async () => {
    const all = prepared.rows.filter((r) => r.pain === "shipping_cost").sort((a, b) => a.customer - b.customer);
    const first = await board.quotes("shipping_cost", 0);
    expect(first.total).toBe(all.length);
    expect(first.rows.map((r) => r.customer)).toEqual(all.slice(0, QUOTE_PAGE).map((r) => r.customer));
    expect(first.rows[0].text).toBe(all[0].quote.text);
    expect(first.rows[0].reached).toBe(journeys[all[0].customer].reached);
    const second = await board.quotes("shipping_cost", QUOTE_PAGE);
    expect(second.rows.map((r) => r.customer)).toEqual(all.slice(QUOTE_PAGE, 2 * QUOTE_PAGE).map((r) => r.customer));
  });

  it("refuses a pain that is not on the list and an offset that is not a whole number at or above 0", async () => {
    await expect(board.quotes("x' OR 1=1" as never, 0)).rejects.toThrow(RangeError);
    await expect(board.quotes("pricing", -1)).rejects.toThrow(RangeError);
    await expect(board.quotes("pricing", 1.5)).rejects.toThrow(RangeError);
  });

  it("stores a correction only after redacting it again, and says how many details it removed", async () => {
    const target = (await board.quotes("pricing", 0)).rows[0];
    const result = await board.correct(target.customer, "Too pricey. Mail me at someone@example.invalid or 501-555-0100.");
    expect(result.text).toBe("Too pricey. Mail me at [EMAIL] or [PHONE].");
    expect(result.removed).toBe(2);
    const after = (await board.quotes("pricing", 0)).rows.find((r) => r.customer === target.customer)!;
    expect(after.text).toBe(result.text);
    const raw = await e.query("SELECT count(*) AS n FROM comments WHERE quote LIKE '%example.invalid%'", []);
    expect(Number(Object.values(raw[0] as object)[0])).toBe(0);
  });

  it("leaves the counts unchanged by a correction, since the pain stays as coded", async () => {
    const before = await board.mentions("reached");
    const target = (await board.quotes("site_bugs", 0)).rows[0];
    await board.correct(target.customer, "Edited.");
    expect(await board.mentions("reached")).toEqual(before);
  });

  it("refuses a correction for a customer with no stored comment", async () => {
    const withheld = comments.find((c) => !c.consent)!;
    await expect(board.correct(withheld.customer, "Hello.")).rejects.toThrow(RangeError);
    await expect(board.correct(999_999, "Hello.")).rejects.toThrow(RangeError);
  });
});
