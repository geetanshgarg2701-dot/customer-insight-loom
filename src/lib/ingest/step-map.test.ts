import { beforeEach, describe, expect, it } from "vitest";
import { customerHash } from "../assignment/hash";
import { checkStepMap, JOURNEY_TARGETS, MAX_MAPPED, MAX_UNMAPPED_NAMES, resolveStep, suggestStep, type StepMap } from "./step-map";
import { applyStepMap, createIngestState, processWebhook, signBody, type IngestConfig, type IngestState } from "./webhook";

const SIGNING = "whsec_" + "a".repeat(40);
const IDENTITY = "ab".repeat(32);
const NOW = new Date("2026-11-20T12:00:00.000Z");
const MAP: StepMap = { page_view: "Visit", add_to_cart: "Cart", order_paid: "Purchase", newsletter_open: null };
const CONFIG: IngestConfig = { signingSecret: SIGNING, identitySecret: IDENTITY, source: "shop-webhook", steps: [], stepMap: MAP };

const ev = (over: Record<string, unknown> = {}) => ({ customer: "ana@example.invalid", step: "add_to_cart", occurred_at: "2026-11-20T11:00:00.000Z", ...over });

async function send(state: IngestState, events: unknown[], config: IngestConfig = CONFIG, at = NOW) {
  const body = JSON.stringify({ events });
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return processWebhook(config, state, { body, signature: await signBody(SIGNING, timestamp, body), timestamp, now: at });
}

describe("checking a step map", () => {
  it("accepts names in a safe form, mapped to a journey step or to ignore", () => {
    expect(checkStepMap(MAP)).toEqual([]);
    expect(JOURNEY_TARGETS).toEqual(["Visit", "Search", "Product", "Cart", "Support", "Purchase"]);
  });

  it("refuses a name in an unsafe form, a target that is not a step, and too many names", () => {
    expect(checkStepMap({ "bad name": "Visit" })).toEqual(['"bad name" is not a usable step name: use 1 to 64 letters, digits, dots, dashes, underscores or colons.']);
    expect(checkStepMap({ x: "Checkout" as never })).toEqual(['"x" maps to "Checkout", which is not a journey step.']);
    expect(checkStepMap({ ["a".repeat(65)]: "Visit" })).toHaveLength(1);
    const many = Object.fromEntries(Array.from({ length: MAX_MAPPED + 1 }, (_, i) => [`e${i}`, "Visit"])) as StepMap;
    expect(checkStepMap(many)).toEqual([`A sender may map at most ${MAX_MAPPED} step names.`]);
  });

  it("does not treat inherited object keys as mapped names", () => {
    expect(resolveStep(MAP, "toString")).toEqual({ kind: "unmapped" });
    expect(resolveStep(MAP, "__proto__")).toEqual({ kind: "unmapped" });
    expect(resolveStep(MAP, "constructor")).toEqual({ kind: "unmapped" });
  });

  it("resolves a mapped name, an ignored name, an unmapped name and a bad one", () => {
    expect(resolveStep(MAP, "add_to_cart")).toEqual({ kind: "mapped", step: "Cart" });
    expect(resolveStep(MAP, "newsletter_open")).toEqual({ kind: "ignored" });
    expect(resolveStep(MAP, "checkout_started")).toEqual({ kind: "unmapped" });
    expect(resolveStep(MAP, "<script>")).toEqual({ kind: "bad" });
    expect(resolveStep(MAP, 7)).toEqual({ kind: "bad" });
  });
});

describe("suggesting a step from a name", () => {
  it.each([
    ["page_view", "Visit"],
    ["landing", "Visit"],
    ["site_search", "Search"],
    ["product_viewed", "Product"],
    ["pdp_view", "Product"],
    ["add_to_cart", "Cart"],
    ["basket.update", "Cart"],
    ["support_ticket", "Support"],
    ["help-chat", "Support"],
    ["order_paid", "Purchase"],
    ["checkout_completed", "Purchase"],
  ])("suggests %s as %s", (name, step) => {
    expect(suggestStep(name)).toBe(step);
  });

  it("suggests nothing when the name gives no clue, rather than guess", () => {
    expect(suggestStep("evt_42")).toBeNull();
    expect(suggestStep("newsletter_open")).toBeNull();
  });
});

describe("the receiver with a step map", () => {
  let state: IngestState;
  beforeEach(() => {
    state = createIngestState();
  });

  it("stores a mapped event under the journey step, and keeps the sender's name", async () => {
    const r = await send(state, [ev()]);
    expect(r.body).toMatchObject({ accepted: 1, ignored: 0, unmapped: 0 });
    expect(state.accepted[0]).toMatchObject({ step: "Cart", senderStep: "add_to_cart" });
  });

  it("counts an ignored name and stores nothing", async () => {
    const r = await send(state, [ev({ step: "newsletter_open" })]);
    expect(r.body).toMatchObject({ accepted: 0, ignored: 1 });
    expect(state.accepted).toHaveLength(0);
    expect(state.review).toHaveLength(0);
    expect(state.ignored).toBe(1);
  });

  it("holds an unmapped event on the review list with only the customer hash, and lists the name for mapping", async () => {
    const r = await send(state, [ev({ step: "checkout_started" }), ev({ step: "checkout_started", customer: "bo@example.invalid" })]);
    expect(r.body).toMatchObject({ accepted: 0, unmapped: 2 });
    expect(state.review.map((x) => [x.kind, x.event?.step])).toEqual([
      ["unmapped", "checkout_started"],
      ["unmapped", "checkout_started"],
    ]);
    expect(state.review[0].reason).toBe('the step name "checkout_started" is not mapped yet');
    expect([...state.unmapped]).toEqual([["checkout_started", 2]]);
    expect(state.review[0].event?.customerHash).toBe(await customerHash(IDENTITY, "ana@example.invalid"));
    expect(JSON.stringify(state.review)).not.toContain("example.invalid");
  });

  it("rejects a name in an unsafe form and does not list it for mapping", async () => {
    const r = await send(state, [ev({ step: "<img src=x>" })]);
    expect(r.body).toMatchObject({ rejected: 1, unmapped: 0 });
    expect(state.unmapped.size).toBe(0);
    expect(state.review[0]).toMatchObject({ kind: "rejected", event: null });
  });

  it("lists at most a fixed number of distinct unmapped names, and counts the rest", async () => {
    const events = Array.from({ length: MAX_UNMAPPED_NAMES + 3 }, (_, i) => ev({ step: `name_${i}` }));
    await send(state, events);
    expect(state.unmapped.size).toBe(MAX_UNMAPPED_NAMES);
    expect(state.unmappedOverflow).toBe(3);
  });

  it("counts a resent unmapped event as a duplicate, not twice on the list", async () => {
    await send(state, [ev({ step: "checkout_started" })]);
    const r = await send(state, [ev({ step: "checkout_started" })]);
    expect(r.body).toMatchObject({ duplicates: 1, unmapped: 0 });
    expect(state.review).toHaveLength(1);
  });

  it("without a step map, behaves as before, with the plain list of steps", async () => {
    const plain: IngestConfig = { ...CONFIG, stepMap: undefined, steps: ["Cart"] };
    const r = await send(state, [ev({ step: "Cart" }), ev({ step: "add_to_cart" })], plain);
    expect(r.body).toMatchObject({ accepted: 1, rejected: 1 });
    expect(r.body).not.toHaveProperty("ignored");
    expect(state.accepted[0]).toMatchObject({ step: "Cart" });
    expect(state.accepted[0]).not.toHaveProperty("senderStep");
  });
});

describe("applying a new mapping to waiting events", () => {
  let state: IngestState;
  beforeEach(() => {
    state = createIngestState();
  });

  it("stores waiting events once their name is mapped, ignores those mapped to ignore, and leaves the rest waiting", async () => {
    await send(state, [ev({ step: "checkout_started" }), ev({ step: "promo_seen" }), ev({ step: "mystery" })]);
    const map: StepMap = { ...MAP, checkout_started: "Cart", promo_seen: null };
    const out = applyStepMap(state, { ...CONFIG, stepMap: map }, NOW);
    expect(out).toEqual({ accepted: 1, ignored: 1, reviewed: 0, waiting: 1 });
    expect(state.accepted[0]).toMatchObject({ step: "Cart", senderStep: "checkout_started" });
    expect(state.review.map((x) => x.event?.step)).toEqual(["mystery"]);
    expect([...state.unmapped]).toEqual([["mystery", 1]]);
  });

  it("puts a waiting event through the same age rules, judged when the mapping is applied", async () => {
    await send(state, [ev({ step: "checkout_started", occurred_at: "2026-11-01T00:00:00.000Z" })]);
    const later = new Date("2026-12-10T00:00:00.000Z");
    const out = applyStepMap(state, { ...CONFIG, stepMap: { ...MAP, checkout_started: "Cart" } }, later);
    expect(out).toEqual({ accepted: 0, ignored: 0, reviewed: 1, waiting: 0 });
    expect(state.review[0]).toMatchObject({ kind: "too_late" });
    expect(state.review[0].event?.step).toBe("Cart");
  });

  it("refuses a map that fails its checks, and changes nothing", async () => {
    await send(state, [ev({ step: "checkout_started" })]);
    expect(() => applyStepMap(state, { ...CONFIG, stepMap: { checkout_started: "Checkout" as never } }, NOW)).toThrow(/not a journey step/);
    expect(state.review).toHaveLength(1);
    expect(state.accepted).toHaveLength(0);
  });
});
