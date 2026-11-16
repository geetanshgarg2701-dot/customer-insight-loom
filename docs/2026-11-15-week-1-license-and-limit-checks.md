# Week 1 task 2: license and free limit checks

Date read: 2026-11-15. Labels: SOURCED means I read the page or registry entry on this date. UNVERIFIED means I could not confirm it. Nothing here comes from memory.

## Licenses, from the npm registry

Source for every row: npm registry entry for the package, read 2026-11-15 with npm view. Version and last modified date are from the same entry.

| Package | Version | License | Last modified | Status |
|---|---|---|---|---|
| echarts | 6.1.0 | Apache-2.0 | 2026-05-19 | SOURCED |
| @visx/visx | 4.0.0 | MIT | 2026-06-11 | SOURCED |
| @tanstack/react-table | 9.3.1 | MIT | 2026-10-12 | SOURCED |
| @tanstack/react-query | 5.107.1 | MIT | 2026-11-06 | SOURCED |
| pptxgenjs | 4.0.1 | MIT | 2025-06-26 | SOURCED |
| xlsx, the npm build | 0.18.5 | Apache-2.0 | 2026-07-17 | SOURCED for the npm build only |
| posthog-js | 1.450.0 | Apache-2.0 AND MIT | 2026-11-15 | SOURCED |
| @marsidev/react-turnstile | 1.6.3 | MIT | 2026-10-21 | SOURCED |
| @duckdb/duckdb-wasm | 1.33.1-dev57.0 | MIT | 2026-11-13 | SOURCED |

Notes:
- The npm registry shows the license the maintainers declared. I did not read each project's LICENSE file, so a mismatch between the declared license and the file is possible but unlikely.
- pptxgenjs was last changed about 17 months ago. That is a maintenance risk, not a license problem. The plan already tests deck export in Week 3.
- xlsx: SheetJS also ships newer builds from its own CDN. I did not check the license of those builds. UNVERIFIED. Ship the npm build, or read the CDN license before using it.
- The duckdb-wasm version is a dev build. Pin the version you tested, and review it in prompt 3.

## Fonts, from the fontsource packages on npm

Source: npm registry entries for the fontsource packages, read 2026-11-15, each at version 5.3.0. Fontsource repackages Google Fonts families.

| Family | Used in direction | License | Status |
|---|---|---|---|
| Newsreader | Lab notebook | OFL-1.1 | SOURCED |
| Public Sans | Lab notebook | OFL-1.1 | SOURCED |
| IBM Plex Mono | Lab notebook and Ledger book | OFL-1.1 | SOURCED |
| Archivo Narrow | Ledger book | OFL-1.1 | SOURCED |
| Sora | Third direction | OFL-1.1 | SOURCED |
| JetBrains Mono | Third direction | OFL-1.1 | SOURCED |

Notes:
- OFL-1.1 is the SIL Open Font License. I did not read the license text today. Its terms are not summarized here.
- Google's own fonts FAQ page returned no readable content, so I have no Google source. The licenses above come from the packages, not from Google.

## Free limits

| Item | What the page says | Source and date | Status |
|---|---|---|---|
| PostHog product analytics | 1M events a month on the free plan | posthog.com/pricing, 2026-11-15 | SOURCED |
| PostHog error tracking | 100K exceptions a month on the free plan | posthog.com/pricing, 2026-11-15 | SOURCED |
| PostHog card | Page states no credit card, not a trial | posthog.com/pricing, 2026-11-15 | SOURCED |
| Supabase Free | 500 MB database per project, 50,000 monthly active users, 1 GB file storage, 5 GB egress plus 5 GB cached, 2 active projects | supabase.com/pricing, 2026-11-15 | SOURCED |
| Supabase pausing | Free projects pause after 1 week of inactivity | supabase.com/pricing, 2026-11-15 | SOURCED |
| Cloudflare Turnstile Free | 20 widgets per account, 10 hostnames per widget, no request cap listed | developers.cloudflare.com/turnstile/plans, 2026-11-15 | SOURCED |
| Figma Starter | Unlimited files in Drafts, co-editing on up to 3 files, 3 pages per co-edited file, 500 AI credits a month | figma.com/pricing-faq, 2026-11-15 | SOURCED |
| Figma Starter, FigJam and Slides file counts | The page gives no Starter-specific count | figma.com/pricing-faq, 2026-11-15 | UNVERIFIED |
| Vercel Hobby, commercial use | Terms section 4 says Hobby is for personal or non-commercial use only | vercel.com/legal/terms, 2026-11-15 | SOURCED |
| Vercel Hobby, limit overrun | In most cases you wait until 30 days have passed before using the feature again | vercel.com/docs/plans/hobby, 2026-11-15 | SOURCED |
| Vercel Hobby, included usage | 100 GB fast data transfer, 1,000,000 function invocations, 100 deployments a day, 50,000 web analytics events a month | vercel.com/docs/plans/hobby, 2026-11-15 | SOURCED |
| Groq free plan limits | The page does not separate free from Developer limits. Its table is described as the base Developer limits. Check the limits page inside your own Groq account | console.groq.com/docs/rate-limits, 2026-11-15 | UNVERIFIED for the free plan |
| Groq card requirement | The page does not say | console.groq.com/docs/rate-limits, 2026-11-15 | UNVERIFIED |
| Wonder credit renewal | Not checked in this task | none | UNVERIFIED |

Groq values the page lists, which may be Developer limits and not free limits: gpt-oss-120b and gpt-oss-20b show 30 requests a minute, 1,000 a day, 8K tokens a minute and 200K tokens a day. Do not plan capacity on these until you read your own account's limits page.

## What changed from the plan

- Sentry is out. PostHog error tracking is in, with 100K exceptions a month listed free. That is a larger allowance than the Sentry 5K figure the plan used, and it carries no card requirement per the page.
- Supabase allows 2 active free projects. You now use 1, the test project. The real project would be the second, so there is no room for a third without pausing one.
- Vercel Hobby is non-commercial only, now confirmed from the Terms. This matches the plan's portfolio-only use.

## Still open

- Groq free plan limits and card requirement, from your own Groq account.
- Figma Starter FigJam and Slides file counts.
- Wonder credit renewal.
- SheetJS CDN build license.
- The OFL-1.1 text and Google's own font statement, if you want a Google source.
