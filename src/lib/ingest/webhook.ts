/**
 * The webhook receiver, plan sections 5.4 and 13.3, as plain code with no server. A request goes in as data and a
 * response comes out as data, and the state it changes is an object passed in. Deploying it later means wiring a route
 * to processWebhook and a database to the state. Nothing here opens a socket, reads a file or calls out.
 *
 * Order of checks, cheapest first and nothing read before it is trusted:
 * 1. Rate limit, 60 requests a minute. The 61st gets 429 and a Retry-After header.
 * 2. Size, 256 KB counted in bytes. Over is 413.
 * 3. Timestamp, whole seconds within 5 minutes of now, then the HMAC SHA-256 signature over "timestamp.body".
 *    Any failure is 401 with the same plain answer, and is logged as a counter with the reason, never the body,
 *    because the sender is not yet known.
 * 4. Only now is the body read: JSON, an events list of 1 to 100.
 * 5. Each event is validated on its own. A failure goes to the review list with the reason, and the rest go through.
 *    Nothing is dropped silently. A full review list counts what it cannot list.
 *
 * Fields the model does not name are never stored, and the customer is stored only as the keyed hash the rest of the
 * app uses, so no email is kept. The numbers are the plan's starting defaults, not measured limits.
 */
import { customerHash, looksLikeEmail, normalizeEmail } from "../assignment/hash";

export const LIMITS = {
  requestsPerMinute: 60,
  maxBodyBytes: 256 * 1024,
  maxEventsPerRequest: 100,
  signatureWindowSeconds: 300,
  acceptDays: 30,
  futureHours: 24,
  retryAfterReadOnlySeconds: 3600,
} as const;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_MAX_REVIEW = 10_000;

/** A finished entry, so an accepted event that lands in its window can flag it as changed since its result. */
export type AffectedEntry = {
  id: string;
  windowStart: string;
  windowEnd: string;
  resultComputed: boolean;
  /** Customer hashes assigned to the entry. */
  assigned: ReadonlySet<string>;
};

export type IngestConfig = {
  /** The sender's HMAC key, any text of 32 characters or more, used as its UTF-8 bytes. */
  signingSecret: string;
  /** The workspace key, in hex, that makes the customer hash. */
  identitySecret: string;
  /** Which sender this is, kept on every accepted event. */
  source: string;
  /** The step names the sender may use, once mapped. */
  steps: readonly string[];
  /** True when storage is full. Events are deferred, and nothing is deleted. */
  readOnly?: boolean;
  entries?: readonly AffectedEntry[];
  maxReview?: number;
};

export type AcceptedEvent = {
  key: string;
  customerHash: string;
  step: string;
  occurredAt: string;
  source: string;
  receivedAt: string;
  /** Finished entries whose result this event may have changed. */
  flags: string[];
};

export type ReviewKind = "rejected" | "too_late" | "in_future" | "deferred";
export type ReviewItem = {
  id: number;
  kind: ReviewKind;
  reason: string;
  receivedAt: string;
  /** Which sender it came from. */
  source: string;
  /** The event, when it was valid enough to read, so a person can accept or dismiss it. Never an email. */
  event: { key: string; customerHash: string; step: string; occurredAt: string } | null;
};

export type IngestState = {
  accepted: AcceptedEvent[];
  keys: Set<string>;
  requestTimes: number[];
  review: ReviewItem[];
  reviewOverflow: number;
  duplicates: number;
  flagged: Map<string, number>;
  unauthenticated: { count: number; reasons: Record<string, number>; lastAt: string | null };
  nextId: number;
};

export function createIngestState(): IngestState {
  return {
    accepted: [],
    keys: new Set(),
    requestTimes: [],
    review: [],
    reviewOverflow: 0,
    duplicates: 0,
    flagged: new Map(),
    unauthenticated: { count: 0, reasons: {}, lastAt: null },
    nextId: 1,
  };
}

export type WebhookRequest = {
  body: string;
  signature: string | null;
  timestamp: string | null;
  now: Date;
};
export type WebhookResponse = { status: number; headers: Record<string, string>; body: Record<string, unknown> };

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a sender computes: HMAC SHA-256, key as UTF-8, over the timestamp, a dot and the raw body, as lower case hex. */
export async function signBody(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}

/** Compares in time that does not depend on where the first difference is. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function respond(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): WebhookResponse {
  return { status, headers: { "Content-Type": "application/json", ...headers }, body };
}

function refuse(state: IngestState, now: Date, status: number, reason: string, headers: Record<string, string> = {}): WebhookResponse {
  // Metadata only. The sender is not authenticated, so no body and no header value is kept.
  state.unauthenticated.count += 1;
  state.unauthenticated.reasons[reason] = (state.unauthenticated.reasons[reason] ?? 0) + 1;
  state.unauthenticated.lastAt = now.toISOString();
  return respond(status, { error: status === 401 ? "unauthorized" : reason }, headers);
}

function addReview(state: IngestState, config: IngestConfig, item: Omit<ReviewItem, "id" | "source">): void {
  if (state.review.length >= (config.maxReview ?? DEFAULT_MAX_REVIEW)) {
    state.reviewOverflow += 1;
    return;
  }
  state.review.push({ id: state.nextId++, source: config.source, ...item });
}

type Valid = { key: string; customerHash: string; step: string; occurredAt: string };

async function validate(raw: unknown, config: IngestConfig, nowIso: string): Promise<{ ok: true; event: Valid } | { ok: false; reason: string }> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "event must be an object" };
  const e = raw as Record<string, unknown>;
  if (e.customer === undefined || e.customer === null || e.customer === "") return { ok: false, reason: "customer is required" };
  if (typeof e.customer !== "string" || e.customer.length > 320 || !looksLikeEmail(normalizeEmail(e.customer))) {
    return { ok: false, reason: "customer is not an email address" };
  }
  if (typeof e.step !== "string" || !config.steps.includes(e.step)) {
    return { ok: false, reason: `step is not one this sender maps: ${config.steps.join(", ")}` };
  }
  const t = typeof e.occurred_at === "string" && e.occurred_at.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(e.occurred_at) ? Date.parse(e.occurred_at) : Number.NaN;
  if (!Number.isFinite(t)) return { ok: false, reason: "occurred_at is not an ISO 8601 time" };
  if (e.idempotency_key !== undefined && (typeof e.idempotency_key !== "string" || e.idempotency_key.length < 1 || e.idempotency_key.length > 200)) {
    return { ok: false, reason: "idempotency_key must be 1 to 200 characters" };
  }
  if (e.external_id !== undefined && (typeof e.external_id !== "string" || e.external_id.length > 200)) {
    return { ok: false, reason: "external_id must be text of up to 200 characters" };
  }
  void nowIso;
  const hash = await customerHash(config.identitySecret, e.customer);
  const occurredAt = new Date(t).toISOString();
  // With no key from the sender, one is built from the source, the customer, the step, the time and any outside id.
  const key = typeof e.idempotency_key === "string" ? `k:${e.idempotency_key}` : `b:${config.source}|${hash}|${e.step}|${occurredAt}|${typeof e.external_id === "string" ? e.external_id : ""}`;
  return { ok: true, event: { key, customerHash: hash, step: e.step, occurredAt } };
}

function flagsFor(config: IngestConfig, event: Valid): string[] {
  const t = Date.parse(event.occurredAt);
  return (config.entries ?? [])
    .filter((x) => x.resultComputed && t >= Date.parse(x.windowStart) && t <= Date.parse(x.windowEnd) && x.assigned.has(event.customerHash))
    .map((x) => x.id);
}

function store(state: IngestState, config: IngestConfig, event: Valid, receivedAt: string): AcceptedEvent {
  const flags = flagsFor(config, event);
  for (const id of flags) state.flagged.set(id, (state.flagged.get(id) ?? 0) + 1);
  const accepted: AcceptedEvent = { ...event, source: config.source, receivedAt, flags };
  state.accepted.push(accepted);
  return accepted;
}

export async function processWebhook(config: IngestConfig, state: IngestState, req: WebhookRequest): Promise<WebhookResponse> {
  const nowMs = req.now.getTime();

  // 1. Rate limit, counted over the last 60 seconds. A refused request is not counted, so a flood cannot extend its own wait.
  state.requestTimes = state.requestTimes.filter((t) => nowMs - t < 60_000);
  if (state.requestTimes.length >= LIMITS.requestsPerMinute) {
    const wait = Math.max(1, Math.ceil((state.requestTimes[0] + 60_000 - nowMs) / 1000));
    return respond(429, { error: "too many requests" }, { "Retry-After": String(wait) });
  }
  state.requestTimes.push(nowMs);

  // 2. Size, in bytes, before anything is parsed.
  if (encoder.encode(req.body).length > LIMITS.maxBodyBytes) return refuse(state, req.now, 413, "payload over 256 KB");

  // 3. Timestamp, then signature.
  if (!req.signature || !req.timestamp) return refuse(state, req.now, 401, "missing signature headers");
  if (!/^\d{1,12}$/.test(req.timestamp)) return refuse(state, req.now, 401, "timestamp is not whole seconds");
  if (Math.abs(nowMs / 1000 - Number(req.timestamp)) > LIMITS.signatureWindowSeconds) {
    return refuse(state, req.now, 401, "timestamp outside the 5 minute window");
  }
  const given = req.signature.replace(/^sha256=/, "").toLowerCase();
  const expected = await signBody(config.signingSecret, req.timestamp, req.body);
  if (!sameHex(given, expected)) return refuse(state, req.now, 401, "bad signature");

  // 4. The body, now that it is trusted.
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return respond(400, { error: "the body is not JSON" });
  }
  const events = (parsed as { events?: unknown } | null)?.events;
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(events)) return respond(400, { error: "the body must be an object with an events list" });
  if (events.length === 0) return respond(400, { error: "the events list is empty" });
  if (events.length > LIMITS.maxEventsPerRequest) {
    return respond(400, { error: `a request may hold at most ${LIMITS.maxEventsPerRequest} events` });
  }

  // 5. Each event on its own.
  const receivedAt = req.now.toISOString();
  const counts = { accepted: 0, duplicates: 0, reviewed: 0, rejected: 0, deferred: 0 };
  const flagged = new Set<string>();
  for (const raw of events) {
    const v = await validate(raw, config, receivedAt);
    if (!v.ok) {
      counts.rejected += 1;
      addReview(state, config, { kind: "rejected", reason: v.reason, receivedAt, event: null });
      continue;
    }
    const { event } = v;
    if (state.keys.has(event.key)) {
      state.duplicates += 1;
      counts.duplicates += 1;
      continue;
    }
    if (config.readOnly) {
      counts.deferred += 1;
      addReview(state, config, { kind: "deferred", reason: "storage is full, so this event waits for room", receivedAt, event });
      continue;
    }
    const t = Date.parse(event.occurredAt);
    if (t > nowMs + LIMITS.futureHours * HOUR_MS) {
      state.keys.add(event.key);
      counts.reviewed += 1;
      addReview(state, config, { kind: "in_future", reason: "the event is more than 24 hours in the future", receivedAt, event });
      continue;
    }
    if (t < nowMs - LIMITS.acceptDays * DAY_MS) {
      state.keys.add(event.key);
      counts.reviewed += 1;
      addReview(state, config, { kind: "too_late", reason: "the event is more than 30 days old", receivedAt, event });
      continue;
    }
    state.keys.add(event.key);
    counts.accepted += 1;
    for (const id of store(state, config, event, receivedAt).flags) flagged.add(id);
  }

  if (config.readOnly) {
    return respond(503, { ...counts, error: "storage is full, try again later" }, { "Retry-After": String(LIMITS.retryAfterReadOnlySeconds) });
  }
  return respond(200, { ...counts, flagged: [...flagged] });
}

/** Accepts a too late event by hand. Only that kind can be accepted, because an event from the future or a rejected one is wrong, not late. */
export function acceptByHand(state: IngestState, id: number, entries?: readonly AffectedEntry[]): AcceptedEvent {
  const i = state.review.findIndex((r) => r.id === id);
  const item = i < 0 ? null : state.review[i];
  if (!item || item.kind !== "too_late" || !item.event) throw new RangeError("Only an event waiting as too late can be accepted by hand.");
  state.review.splice(i, 1);
  // The same flagging applies as for any accepted event, so a late event inside a finished entry's window still marks it.
  return store(state, { source: item.source, entries } as IngestConfig, item.event, item.receivedAt);
}

/** Removes an item from the review list without accepting it. The event is not stored. */
export function dismiss(state: IngestState, id: number): void {
  const i = state.review.findIndex((r) => r.id === id);
  if (i < 0) throw new RangeError("That review item does not exist.");
  state.review.splice(i, 1);
}
