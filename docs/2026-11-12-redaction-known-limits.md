# Redaction module: measured results and known limits

Measured on commit ff0f5e6, Thursday November 12, 2026. Source: the planted set run in `src/lib/redaction/testdata/planted.ts`, scored by `planted.test.ts`.

## What was measured

The planted set has 200 synthetic items, 50 per type. Emails use reserved example domains. Phones use the fictional 555-01xx block plus UK and Australian drama ranges. Cards use documented test prefixes with a computed check digit. Street names are made up. The set deliberately mixes in formats that a rule-based redactor is expected to miss, and that mix was fixed before the redactor existed.

| Type | Planted | Caught | Missed |
|---|---|---|---|
| email | 50 | 44 | 6 |
| phone | 50 | 48 | 2 |
| card | 50 | 50 | 0 |
| address | 50 | 46 | 4 |
| all | 200 | 188 | 12 |

The whole project had 97 passing tests at this commit, and `tsc --noEmit` was clean.

One real bug was found and fixed after the first run. The generic street rule matched "79684 in the new place" because "place" counts as a street suffix, and that match won over the PO box rule, so "PO Box" stayed readable. The PO box rule now runs first. Before the fix the address row was 45 of 50.

## The 12 misses

These are known limits for v1. They are not being tuned away, because tuning rules until they pass a set we wrote ourselves would fit the test, not improve the redactor.

- **Obfuscated emails, 6:** the form "name at example dot com". Not detected.
- **Spelled-out phones, 2:** a number written as words. Not detected.
- **No street suffix, 3:** "8073 Broadway", "290 Route 93" and "164 Route 82". Not detected.
- **Suffix in the middle, 1:** "8123 County Road 72". Partly matched, so part of the address would still show.

## Other limits

- **Names are not covered.** The rules do not detect personal names. A test confirms that "My name is Jane Doe" passes through unchanged. Redacted output is not anonymous.
- **Phone and address matching is US-centric.** Phones are North American plus a basic plus-sign international form.
- **The street rule is case-insensitive.** It can over-match phrases like "2 big dogs on the Drive". That is the safe direction, but it will over-redact some ordinary text.
- **False positives are not measured.** The planted set only measures misses.
- **The test data is synthetic.** Real customer text will contain formats this set does not have. Treat 188 of 200 as a measurement on this set, not a promise about real data.

## What the module guarantees

- `saveQuote` accepts only a `RedactedQuote`. A plain object is a compile-time error, checked by `@ts-expect-error` in `quote.test.ts`.
- A cast can forge a brand, so `redactQuote` also records each quote it issues in a private `WeakSet`, and `saveQuote` throws `UnredactedQuoteError` for anything not in it. Tests cover a plain object, a forged cast, a spread copy and a JSON round trip.
- `redactQuote` throws `BlockedColumnError` for identity columns such as email, name, phone and address. It also re-runs redaction on its own output and refuses to issue a stamp if anything is still found.
- Column rules fail closed. `ip_address` and `email_sent_count` are blocked too. `campaign_name` and `product_name` are allowed.
- The database side of this, a constraint that rejects quote rows without a redaction pass stamp, is still to come with the Supabase schema.
