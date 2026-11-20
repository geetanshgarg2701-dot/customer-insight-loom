import { beforeEach, describe, expect, it } from "vitest";
import { customerHash } from "../assignment/hash";
import { LIMITS, acceptByHand, createIngestState, dismiss, processWebhook, signBody, type IngestConfig, type IngestState } from "./webhook";

const SIGNING = "whsec_" + "a".repeat(40);
const IDENTITY = "ab".repeat(32);
const NOW = new Date("2026-11-20T12:00:00.000Z");
const seconds = (d: Date) => String(Math.floor(d.getTime() / 1000));
const CONFIG: IngestConfig = { signingSecret: SIGNING, identitySecret: IDENTITY, source: "shop-webhook", steps: ["Visit", "Product", "Cart", "Purchase"] };

const ev = (over: Record<string, unknown> = {}) => ({
  customer: "ana@example.invalid",
  step: "Cart",
  occurred_at: "2026-11-20T11:00:00.000Z",
  ...over,
});

async function send(
  state: IngestState,
  events: unknown[] | string,
  opts: { at?: Date; config?: Partial<IngestConfig>; tamper?: boolean; timestamp?: string; signature?: string | null } = {},
) {
  const at = opts.at ?? NOW;
  const body = typeof events === "string" ? events : JSON.stringify({ events });
  const timestamp = opts.timestamp ?? seconds(at);
  const signature = opts.signature === undefined ? await signBody(SIGNING, timestamp, body) : opts.signature;
  return processWebhook({ ...CONFIG, ...opts.config }, state, { body: opts.tamper ? body + " " : body, signature, timestamp, now: at });
}

let state: IngestState;
beforeEach(() => {
  state = createIngestState();
});

describe("signing, plan 5.4", () => {
  it("accepts a correctly signed request and stores the event with a keyed hash of the customer, never the email", async () => {
    const r = await send(state, [ev()]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: 1, duplicates: 0, reviewed: 0, rejected: 0 });
    expect(state.accepted).toHaveLength(1);
    expect(state.accepted[0]).toMatchObject({ step: "Cart", occurredAt: "2026-11-20T11:00:00.000Z", source: "shop-webhook" });
    expect(state.accepted[0].customerHash).toBe(await customerHash(IDENTITY, "ana@example.invalid"));
    expect(JSON.stringify(state)).not.toContain("ana@example.invalid");
  });

  it("rejects a body changed after signing, with a plain 401 that gives the sender no reason", async () => {
    const r = await send(state, [ev()], { tamper: true });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "unauthorized" });
    expect(state.accepted).toHaveLength(0);
  });

  it("rejects a missing signature, a signature from another secret, and one that is not hex, all the same way", async () => {
    const wrong = await signBody("another secret entirely, long enough to be one", seconds(NOW), JSON.stringify({ events: [ev()] }));
    for (const signature of [null, "", wrong, "zz".repeat(32)]) {
      const r = await send(state, [ev()], { signature });
      expect([r.status, r.body], String(signature)).toEqual([401, { error: "unauthorized" }]);
    }
    expect(state.accepted).toHaveLength(0);
  });

  it("accepts the sha256= prefix on the signature", async () => {
    const body = JSON.stringify({ events: [ev()] });
    const sig = await signBody(SIGNING, seconds(NOW), body);
    expect((await send(state, [ev()], { signature: `sha256=${sig}` })).status).toBe(200);
  });

  it("rejects a timestamp older than 5 minutes, which blocks a replay, and takes one at exactly 5 minutes", async () => {
    const body = [ev()];
    const old = new Date(NOW.getTime() - 301_000);
    const edge = new Date(NOW.getTime() - 300_000);
    expect((await send(state, body, { timestamp: seconds(old) })).status).toBe(401);
    expect((await send(state, body, { timestamp: seconds(edge) })).status).toBe(200);
  });

  it("rejects a timestamp more than 5 minutes ahead and one that is not whole seconds", async () => {
    expect((await send(state, [ev()], { timestamp: seconds(new Date(NOW.getTime() + 301_000)) })).status).toBe(401);
    for (const timestamp of ["", "soon", "1.5e9", "-1", "1795176000.5"]) {
      expect((await send(state, [ev()], { timestamp })).status, timestamp).toBe(401);
    }
  });

  it("logs a bad request as metadata only, never the body, and collapses repeats into one counter by reason", async () => {
    for (let i = 0; i < 3; i++) await send(state, [ev({ customer: "secret.person@example.invalid" })], { tamper: true });
    await send(state, [ev()], { timestamp: seconds(new Date(NOW.getTime() - 400_000)) });
    expect(state.unauthenticated.count).toBe(4);
    expect(state.unauthenticated.reasons).toEqual({ "bad signature": 3, "timestamp outside the 5 minute window": 1 });
    expect(state.review).toHaveLength(0);
    expect(JSON.stringify(state)).not.toContain("secret.person");
  });
});

describe("limits, plan 5.4", () => {
  it("answers the 61st request in a minute with 429 and a Retry-After header, and lets one through when the minute has passed", async () => {
    for (let i = 0; i < LIMITS.requestsPerMinute; i++) {
      expect((await send(state, [ev({ occurred_at: `2026-11-20T10:${String(i % 60).padStart(2, "0")}:00.000Z` })], { at: new Date(NOW.getTime() + i * 100) })).status).toBe(200);
    }
    const blocked = await send(state, [ev()], { at: new Date(NOW.getTime() + 10_000) });
    expect(blocked.status).toBe(429);
    // The oldest request was at NOW, so the window frees at NOW plus 60 seconds, 50 seconds after this request.
    expect(blocked.headers["Retry-After"]).toBe("50");
    expect((await send(state, [ev()], { at: new Date(NOW.getTime() + 61_000) })).status).toBe(200);
  });

  it("rejects a body over 256 KB with 413 and a reason on the counter, without reading it", async () => {
    const big = JSON.stringify({ events: [ev({ external_id: "x".repeat(LIMITS.maxBodyBytes) })] });
    const r = await send(state, big);
    expect(r.status).toBe(413);
    expect(state.unauthenticated.reasons).toEqual({ "payload over 256 KB": 1 });
    expect(state.accepted).toHaveLength(0);
  });

  it("takes exactly 256 KB and refuses one byte more", async () => {
    const pad = (c: string, n: number) => JSON.stringify({ events: [], pad: c.repeat(n) });
    const base = new TextEncoder().encode(pad("a", 0)).length;
    const fit = LIMITS.maxBodyBytes - base;
    expect(new TextEncoder().encode(pad("a", fit)).length).toBe(LIMITS.maxBodyBytes);
    expect((await send(state, pad("a", fit))).status).toBe(400); // passes the size check, then has no events
    expect((await send(state, pad("a", fit + 1))).status).toBe(413);
  });

  it("counts bytes, not characters, so two byte characters fill the limit twice as fast", async () => {
    const chars = Math.floor(LIMITS.maxBodyBytes / 2);
    const body = JSON.stringify({ events: [], pad: "é".repeat(chars) });
    expect(body.length).toBeLessThan(LIMITS.maxBodyBytes);
    expect((await send(state, body)).status).toBe(413);
  });

  it("rejects a request with more than 100 events as a whole, naming the limit", async () => {
    const r = await send(state, Array.from({ length: 101 }, () => ev()));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("at most 100 events");
    expect(state.accepted).toHaveLength(0);
    expect((await send(state, Array.from({ length: 100 }, (_, i) => ev({ occurred_at: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString() })))).body).toMatchObject({ accepted: 100 });
  });

  it("rejects a body that is not JSON, not an object with events, or has none", async () => {
    for (const body of ["not json", "[]", '{"events":"no"}', '{"events":[]}']) {
      expect((await send(state, body)).status, body).toBe(400);
    }
  });
});

describe("events, plan 5.4", () => {
  it("validates every event and sends each failure to the review list with the reason, while the good ones go through", async () => {
    const r = await send(state, [
      ev(),
      ev({ customer: "not an email" }),
      ev({ step: "Checkout" }),
      ev({ occurred_at: "yesterday" }),
      ev({ customer: undefined }),
      ev({ idempotency_key: "" }),
      "just a string",
      ev({ external_id: 5 }),
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: 1, rejected: 7 });
    expect(state.review.map((x) => [x.kind, x.reason])).toEqual([
      ["rejected", "customer is not an email address"],
      ["rejected", "step is not one this sender maps: Visit, Product, Cart, Purchase"],
      ["rejected", "occurred_at is not an ISO 8601 time"],
      ["rejected", "customer is required"],
      ["rejected", "idempotency_key must be 1 to 200 characters"],
      ["rejected", "event must be an object"],
      ["rejected", "external_id must be text of up to 200 characters"],
    ]);
  });

  it("keeps no field the model does not name, and no email in the review list", async () => {
    await send(state, [ev({ customer: "bad email", phone: "+1 202 555 0143", note: "free text" })]);
    expect(state.review[0].event).toBeNull();
    await send(state, [ev({ phone: "+1 202 555 0143", note: "free text" })], { at: new Date(NOW.getTime() + 61_000) });
    expect(JSON.stringify(state)).not.toMatch(/202 555 0143|free text|ana@example/);
  });

  it("normalizes the time to UTC and the customer by the identity rule, so one person under two spellings is one hash", async () => {
    await send(state, [ev({ customer: "  Ana@Example.INVALID ", occurred_at: "2026-11-20T13:00:00+02:00" })]);
    expect(state.accepted[0].occurredAt).toBe("2026-11-20T11:00:00.000Z");
    expect(state.accepted[0].customerHash).toBe(await customerHash(IDENTITY, "ana@example.invalid"));
    const other = await customerHash(IDENTITY, "ana+promo@example.invalid");
    expect(other).not.toBe(state.accepted[0].customerHash);
  });

  it("stores a resent event once and counts the duplicate, by its key or, with none, by source, customer, step and time", async () => {
    await send(state, [ev({ idempotency_key: "k1" })]);
    const again = await send(state, [ev({ idempotency_key: "k1" }), ev({ idempotency_key: "k2" })], { at: new Date(NOW.getTime() + 1_000) });
    expect(again.body).toMatchObject({ accepted: 1, duplicates: 1 });
    await send(state, [ev(), ev()], { at: new Date(NOW.getTime() + 2_000) });
    expect(state.accepted).toHaveLength(3);
    expect(state.duplicates).toBe(2);
    // A different step is a different event.
    await send(state, [ev({ step: "Purchase" })], { at: new Date(NOW.getTime() + 3_000) });
    expect(state.accepted).toHaveLength(4);
  });

  it("uses the order events happened, not the order they arrived", async () => {
    await send(state, [ev({ step: "Purchase", occurred_at: "2026-11-20T11:30:00.000Z" }), ev({ step: "Cart", occurred_at: "2026-11-20T11:00:00.000Z" })]);
    expect(state.accepted.map((e) => e.step)).toEqual(["Purchase", "Cart"]);
    expect([...state.accepted].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((e) => e.step)).toEqual(["Cart", "Purchase"]);
  });
});

describe("late and future events, plan 5.4", () => {
  it("takes an event up to 30 days old, and sends one older than 30 days to the review list as too late", async () => {
    const edge = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    const late = new Date(NOW.getTime() - 30 * 86_400_000 - 1000).toISOString();
    const r = await send(state, [ev({ occurred_at: edge }), ev({ occurred_at: late, step: "Product" })]);
    expect(r.body).toMatchObject({ accepted: 1, reviewed: 1 });
    expect(state.review).toHaveLength(1);
    expect(state.review[0]).toMatchObject({ kind: "too_late", reason: "the event is more than 30 days old" });
    expect(state.review[0].event).toMatchObject({ step: "Product", occurredAt: late });
  });

  it("lists a resent too late event once and counts the resend as a duplicate", async () => {
    const late = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
    await send(state, [ev({ occurred_at: late })]);
    const again = await send(state, [ev({ occurred_at: late })], { at: new Date(NOW.getTime() + 1_000) });
    expect(again.body).toMatchObject({ duplicates: 1, reviewed: 0 });
    expect(state.review).toHaveLength(1);
  });

  it("sends an event more than 24 hours ahead to the review list, and takes one at exactly 24 hours", async () => {
    const edge = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    const ahead = new Date(NOW.getTime() + 24 * 3_600_000 + 1000).toISOString();
    const r = await send(state, [ev({ occurred_at: edge }), ev({ occurred_at: ahead, step: "Product" })]);
    expect(r.body).toMatchObject({ accepted: 1, reviewed: 1 });
    expect(state.review[0]).toMatchObject({ kind: "in_future", reason: "the event is more than 24 hours in the future" });
  });

  it("lets a person accept a too late event by hand, once, and dismiss another", async () => {
    const late = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
    await send(state, [ev({ occurred_at: late }), ev({ occurred_at: late, step: "Product" })]);
    const [first, second] = state.review;
    const accepted = acceptByHand(state, first.id);
    expect(accepted).toMatchObject({ step: "Cart", occurredAt: late });
    expect(state.accepted).toHaveLength(1);
    expect(state.review.map((x) => x.id)).toEqual([second.id]);
    expect(() => acceptByHand(state, first.id)).toThrow(RangeError);
    dismiss(state, second.id);
    expect(state.review).toEqual([]);
    expect(state.accepted).toHaveLength(1);
  });

  it("will not accept by hand an event that was rejected or is in the future", async () => {
    await send(state, [ev({ step: "Nope" }), ev({ occurred_at: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() })]);
    for (const item of state.review) expect(() => acceptByHand(state, item.id), item.kind).toThrow(RangeError);
  });

  it("flags a finished entry when an accepted event lands in its window for someone assigned to it", async () => {
    const hash = await customerHash(IDENTITY, "ana@example.invalid");
    const entries = [
      { id: "done", windowStart: "2026-11-01T00:00:00.000Z", windowEnd: "2026-11-08T00:00:00.000Z", resultComputed: true, assigned: new Set([hash]) },
      { id: "open", windowStart: "2026-11-01T00:00:00.000Z", windowEnd: "2026-11-08T00:00:00.000Z", resultComputed: false, assigned: new Set([hash]) },
      { id: "other-person", windowStart: "2026-11-01T00:00:00.000Z", windowEnd: "2026-11-08T00:00:00.000Z", resultComputed: true, assigned: new Set(["f".repeat(64)]) },
    ];
    const r = await send(state, [ev({ occurred_at: "2026-11-05T10:00:00.000Z" }), ev({ occurred_at: "2026-11-09T10:00:00.000Z", step: "Product" })], { config: { entries } });
    expect(r.body).toMatchObject({ accepted: 2, flagged: ["done"] });
    expect(state.accepted[0].flags).toEqual(["done"]);
    expect(state.accepted[1].flags).toEqual([]);
    expect(Object.fromEntries(state.flagged)).toEqual({ done: 1 });
  });
});

describe("when storage is full, plan 13.3", () => {
  it("answers 503 with Retry-After, deletes nothing, and lists each good event as deferred", async () => {
    await send(state, [ev()]);
    const r = await send(state, [ev({ step: "Purchase" }), ev({ step: "Nope" })], { config: { readOnly: true }, at: new Date(NOW.getTime() + 1_000) });
    expect(r.status).toBe(503);
    expect(r.headers["Retry-After"]).toBe("3600");
    expect(r.body).toMatchObject({ deferred: 1 });
    expect(state.accepted).toHaveLength(1);
    expect(state.review.map((x) => x.kind)).toEqual(["deferred", "rejected"]);
    expect(state.review[0].event).toMatchObject({ step: "Purchase" });
  });
});

describe("a full review list", () => {
  it("counts what it cannot list instead of dropping it silently", async () => {
    for (let i = 0; i < 3; i++) await send(state, [ev({ step: "Nope" })], { config: { maxReview: 2 } as Partial<IngestConfig>, at: new Date(NOW.getTime() + i * 100) });
    expect(state.review).toHaveLength(2);
    expect(state.reviewOverflow).toBe(1);
  });
});
