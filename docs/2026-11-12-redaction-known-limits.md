# Redaction module: measured results and known limits

First measured on commit ff0f5e6, Thursday November 12, 2026. Rules updated to version 2 on Monday November 16, 2026, and the planted set was run again. Source: the planted set run in `src/lib/redaction/testdata/planted.ts`, scored by `planted.test.ts`.

## What was measured

The planted set has 200 synthetic items, 50 per type. Emails use reserved example domains. Phones use the fictional 555-01xx block plus UK and Australian drama ranges. Cards use documented test prefixes with a computed check digit. Street names are made up. The set deliberately mixes in formats that a rule-based redactor is expected to miss, and that mix was fixed before the redactor existed.

| Type | Planted | Caught | Missed |
|---|---|---|---|
| email | 50 | 44 | 6 |
| phone | 50 | 48 | 2 |
| card | 50 | 50 | 0 |
| address | 50 | 46 | 4 |
| all | 200 | 188 | 12 |

The result is unchanged at version 2, because the planted set has no social security numbers or IP addresses and every planted card already had a valid checksum. The whole project had 419 passing tests after the version 2 change, and `tsc --noEmit` was clean.

One real bug was found and fixed after the first run. The generic street rule matched "79684 in the new place" because "place" counts as a street suffix, and that match won over the PO box rule, so "PO Box" stayed readable. The PO box rule now runs first. Before the fix the address row was 45 of 50.

## The 12 misses

These are known limits for v1. They are not being tuned away, because tuning rules until they pass a set we wrote ourselves would fit the test, not improve the redactor.

- **Obfuscated emails, 6:** the form "name at example dot com". Not detected.
- **Spelled-out phones, 2:** a number written as words. Not detected.
- **No street suffix, 3:** "8073 Broadway", "290 Route 93" and "164 Route 82". Not detected.
- **Suffix in the middle, 1:** "8123 County Road 72". Partly matched, so part of the address would still show.

## Rule version 2 changes

- **Emails** are found by a bounded scan outward from each at sign, so time grows with the input length. Letters and digits from any script count, invisible characters inside an address are read as part of it, and `%40` and the full width at sign work as the at sign. The old single pattern took 8.7 seconds on one 100,000 character token.
- **Cards** are any run of 13 to 19 digits with up to two spaces, dots or dashes between digits, with no checksum test. A mistyped card number is still a card number. Runs of 12 or fewer digits and 20 or more digits are left alone.
- **New types:** US social security numbers written with dashes or spaces, and IPv4 addresses with no part above 255. Nine bare digits are not matched.
- **Columns:** a column name that itself holds personal data is blocked, errors never repeat the column text, and a file with no header row shows its first row as "Column 1", "Column 2" and so on, never as the values.
- **Quotes:** text over 20,000 characters is refused, not cut. A source column over 200 characters, or one that holds personal data, is refused. The store hands out frozen copies.
- **Over-redaction is now possible and accepted:** a four part version string such as 1.2.3.4 reads as an IP address, and a 13 digit timestamp reads as a card.

## Not covered in version 2

Date of birth, seven digit phones, city and ZIP code, non-US postcodes and street formats, IBAN, social media handles and URLs, order numbers, IPv6, full width digits, and obfuscated forms such as "jane at example dot com".

## Other limits

- **Names are not covered.** The rules do not detect personal names. A test confirms that "My name is Jane Doe" passes through unchanged. Redacted output is not anonymous.
- **Phone and address matching is US-centric.** Phones are North American plus a basic plus-sign international form.
- **The street rule is case-insensitive.** It can over-match phrases like "2 big dogs on the Drive". That is the safe direction, but it will over-redact some ordinary text.
- **False positives are not measured.** The planted set only measures misses.
- **The test data is synthetic.** Real customer text will contain formats this set does not have. Treat 188 of 200 as a measurement on this set, not a promise about real data.

## What the module guarantees

- `saveQuote` accepts only a `RedactedQuote`. A plain object is a compile-time error, checked by `@ts-expect-error` in `quote.test.ts`.
- A cast can forge a brand, so `redactQuote` also records each quote it issues in a private `WeakSet`, and `saveQuote` throws `UnredactedQuoteError` for anything not in it. Tests cover a plain object, a forged cast, a spread copy and a JSON round trip.
- `redactQuote` throws `BlockedColumnError` for identity columns such as email, name, phone and address, and `SourceColumnError` or `QuoteTooLongError` for the cases above. It also re-runs redaction on its own output and refuses to issue a stamp if anything is still found.
- Column rules fail closed. `ip_address` and `email_sent_count` are blocked too. `campaign_name` and `product_name` are allowed.
- The database side of this, a constraint that rejects quote rows without a redaction pass stamp, is still to come with the Supabase schema.
