# Part B: Sections 6, 9 and 13

Build and launch plan for the evidence ledger app. This file continues the Part A file dated 2026-11-11, which settled sections 1, 2, 3 and 5. Claims are labeled sourced, inferred or speculation. Sourced claims carry a URL and a date. All dates are the date the source was checked, 2026-11-11, unless a publication date is shown.

---

## Section 6: Version 1 proof core spec

### 6.1 Ledger schema

The learning ledger is the single memory. One entry per campaign or journey launch. Inferred: this schema is my design, derived from the prompt's requirements, not from any source.

**Table: ledger_entries**

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| workspace_id | uuid | Row level security key |
| title | text | Short human name |
| hypothesis | text | Written before launch |
| registered_at | timestamptz | When the hypothesis was saved, UTC |
| launched_at | timestamptz | Null until launch, UTC |
| entry_type | enum | confirmatory if registered_at is earlier than launched_at, else exploratory. Computed by code, never editable by hand |
| theme_id | uuid null | Link to the research theme behind the hypothesis |
| segment_id | uuid null | Audience |
| journey_id | uuid null | The journey or campaign under test |
| framework_tag | enum null | PAS, FAB or AIDA when the entry tests a draft |
| design | jsonb | Holdout split share, expected lift, minimum detectable effect, primary metric, conversion window hours |
| power_result | jsonb | Required n per arm, available n, pass or fail, computed at registration |
| result | jsonb | The first result: lift, interval low, interval high, incremental revenue with its interval, sample sizes per arm, srm_pass flag, computed_at, engine_version. Locked once recorded. Later readouts are rows in ledger_result_versions, numbered from 1, with a reason, never an overwrite |
| comparisons_count | int | How many comparisons the readout screen made |
| correction_method | text | benjamini_hochberg or exploratory_label |
| status | enum | draft, registered, running, readable, closed |

**Table: ledger_citations.** entry_id, cited_row_table, cited_row_id, created_at. Every claim the assistant makes about an entry points here, and code checks each cited id exists.

**Table: ledger_audit.** entry_id, actor, action, at. Append only.

**Export and import.** One click exports the workspace ledger as one JSON file with a schema_version field, entries, citations and audit rows. Import validates the schema version, rejects unknown versions with a plain message, and inserts under the importing workspace's id. Test: export from one account, import into a fresh account, diff entry counts and a hash of sorted entry ids. Inferred: file format is my choice. In the public demo the ledger lives in browser memory backed by DuckDB-Wasm and the same export file is the only persistence, as section 13 describes.

**Seeding.** The guided first run creates three synthetic entries, one confirmatory with a readable result, one exploratory, one running, each labeled synthetic on screen. Inferred.

### 6.2 Holdout and power check design

**Assignment.** Deterministic: take a keyed hash of the workspace secret plus the normalized customer email hash, map it to an integer from 0 to 99, and assign treatment when the integer is below the split share. The assignment is stored in an assignments table at registration time, so re-runs cannot reshuffle. Inferred: standard practice, my design.

**The version 1 gap and its fix.** Part A flagged that version 1 sends nothing, so the holdout must work through the user's own send tool. The fix stands as proposed there: version 1 exports the assignment list as a CSV with customer email hash, group and entry id, and accepts a results upload that carries a group column back. This decision is still open for your confirmation. Inferred.

**Power check at registration.** Two proportion test, alpha 0.05 two sided, power 0.80. Required n per arm comes from the exact two proportion formula, which is built in `src/lib/stats/power.ts`: the sum of the alpha and power quantile terms, squared, divided by the square of the minimum detectable difference, using the baseline rate p from the user's own past data over the chosen window and the treatment rate p plus the difference. The rule of thumb, 16 times p times the quantity one minus p, divided by the square of the difference, is kept only as a sanity check, because it undercounts: at a 2 percent baseline and a 2 point lift it gives 784 per arm against 1,141 exact, and at 10 percent and 2 points 3,601 against 3,841. The screen also shows the smallest lift the available audience can detect, so a pass for a large lift does not hide a weak audience. The app shows required n per arm beside available n and blocks the confirmatory label when available n is short, offering to register as exploratory instead. Inferred: the formula is the standard normal approximation found in experiment design texts; I am not citing a URL because it is textbook material, and the A/A and planted lift checks below are what verify the implementation.

**Readout.** Lift equals treatment rate minus control rate. Interval: two proportion z interval with the Newcombe refinement where counts are small. Incremental revenue is not shown as lift times audience times one average order value, because that has the wrong sign when the treatment changes order value: with control at 10 percent and 50 dollars, and treatment at 12 percent and 40 dollars after a discount, the shortcut gives plus 10,000 dollars on 10,000 treated while revenue per recipient is 5.00 against 4.80, a true loss of 2,000. Version 1 shows revenue only when both arms report revenue per recipient, as the difference of the two arm means with an interval, and otherwise shows the lift without a revenue figure. The helper in `src/lib/stats/readout.ts` that multiplies lift by one order value is not used on any screen and states its equal order value assumption in its own note. People whose window has not closed are shown separately and excluded, per section 5. Inferred: standard methods, my selection.

**Safeguards, all computed in DuckDB.**
- Sample ratio mismatch: chi square test on assignment counts against the planned split, flagged when the p value is below 0.001, which blocks the readout with a plain data problem message. Inferred: the 0.001 threshold is common industry practice, labeled judgment.
- Variance reduction: CUPED is version 2, not version 1. The version 1 interval method is for yes or no outcomes, and an adjusted metric is not yes or no, so no interval method is built for it. The gain may also be small: at a correlation of 0.3 between the pre period and the outcome the need per arm falls from 3,841 to about 3,496. When it is added, the analysis choice must be recorded at registration, because choosing CUPED after seeing the data is a fork. Inferred, with the correlation values a guess.
- Sequential stopping: not in version 1. The engine is fixed horizon, the readout unlocks only when the conversion window closes, and the interface says so. Honest reason: correct sequential rules are real work and a wrong one silently inflates false positives, which breaks the product's whole promise. Deferred to version 2 at the earliest. Inferred, judgment.
- Holdout protection: the suppression list for an entry includes its control group for the life of the window, enforced in the pre send compliance check. Inferred.

**PowerPoint export.** One click, built in the browser with PptxGenJS: title, hypothesis, design, lift with range and plain sentence, sample sizes, SRM status, ledger entry link. Chart image export from ECharts into the deck is flagged unverified in the tool menu and must be tested in Week 1; the fallback is a table slide. Inferred.

### 6.3 Statistical honesty plan

All three checks run on synthetic data before version 1 ships, and results are reported as counts inside the app's methods page.

- **A/A simulations.** Generate 1,000 simulated experiments where both arms draw from the same conversion rate. Count how many the engine calls significant at alpha 0.05. Expected count is about 50. The acceptance band is 37 to 64, which is the central 95 percent range of a binomial with n 1,000 and p 0.05, computed, not sourced. A correct engine lands outside any 95 percent band in about 4 percent of runs, so one run outside is a prompt to rerun with other seeds, not proof of a bug. Investigate the engine before launch only when the rerun also falls outside. The app's methods page shows the actual count.
- **Planted lift.** Generate 500 experiments with a known true lift. Report the count whose interval contains the true lift, expected about 475 of 500, and the count where the power check's promise held. The promise is held when the detected count is at least the lower end of the central 95 percent range of a binomial with 500 runs and p equal to the stated power, which is 382 for power 0.80, computed. The literal rule, detected at least as often as the stated power, would fail a correct engine about 47 percent of the time, so it is not used. A correct engine misses the floor about 2 times in 100. Reported as counts.
- **Multiple comparisons.** Chosen method: Benjamini Hochberg. Two line reason: the comparison heavy screens are discovery scans across many segments, themes and steps, where controlling the share of false discoveries keeps real signals visible; Holm controls the stricter familywise rate, and the gap between the two grows with the number of comparisons, not with sample size. For three segments with p values 0.012, 0.03 and 0.04, Benjamini Hochberg rejects all three and Holm only the first, so with few comparisons Holm is the safer choice, and the plan is to use Holm for fewer than 10 comparisons. Neither procedure is applied on a screen yet; `benjaminiHochberg` exists in `src/lib/stats/bh.ts` and Holm is not built. Benjamini Hochberg assumes the tests are independent or positively dependent, which overlapping segments may break, and any screen that uses it must say so. Any view comparing more than one group shows the number of comparisons made. Results from comparisons not registered before launch are always labeled exploratory regardless of correction. Inferred: method choice is judgment; both procedures are standard statistics.
- **Plain language method note.** The app states in the interface: these checks ran on generated data and they verify the calculator, not any real world result.

### 6.4 Evidence chain data model

Inferred throughout: my design.

**Table: themes.** id, workspace_id, name, kind as job, pain or gain, severity as low, medium or high with a judgment label, created_by as ai or human, corrected_by_human flag.

**Table: quotes.** id, theme_id, source_document, redacted_text, consent_flag, redaction_passed_at. A database constraint rejects inserts where redaction_passed_at is null, which is the enforcement point for the rule that no quote is stored without passing redaction. Consent_flag must be true for display anywhere.

**Table: record_tags.** customer_id, theme_id, source as survey, review, ticket or note, tagged_at. Segments inherit tags by rule: a segment carries a theme when at least a set share of its members carry it, threshold adjustable, default 20 percent, labeled judgment on screen.

**Pain ranking.** Code counts mentions per pain in SQL. AI codes severity per quote and a person can correct it, with corrections stored and the corrected flag set. Revenue exposure per pain equals the summed revenue over the chosen window of customers tagged with that pain, labeled association on screen, never cause, unless a ledger entry with a holdout supports the causal reading. Groups under 30 tagged customers show muted with a too small to trust warning; the 30 is judgment and is shown as such in the tooltip.

### 6.5 Framework tags

Drafts carry framework_tag PAS, FAB or AIDA, plus hook_rule and cta_rule short text fields. The tag writes to the ledger entry at registration so readouts can compare frameworks across entries. Every draft shows an AI generated label. Inferred.

### 6.6 Compliance rules with sources and dates

The pre send compliance check blocks approval when any row fails. Each rule shows its source and last checked date in the interface. Version 1 scopes to US commercial email; a pilot user mailing EU or Canadian recipients gets a plain warning that GDPR and CASL checks are not built. Inferred scope decision.

| Rule checked | Requirement | Source, publication or check date | Tier |
|---|---|---|---|
| Unsubscribe present and honored | Clear opt out mechanism in every commercial email, honored within 10 business days | FTC CAN-SPAM compliance guide, ftc.gov, checked 2026-11-11, https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business | 1 |
| Physical postal address | Valid physical postal address in every commercial email | Same FTC guide, checked 2026-11-11 | 1 |
| Honest headers and subject | No false or misleading routing information, no deceptive subject lines, ads identified as ads | Same FTC guide, checked 2026-11-11 | 1 |
| Penalty context shown to user | Violations subject to penalties up to 53,088 dollars per email | Same FTC guide, checked 2026-11-11 | 1 |
| One click unsubscribe header | Bulk senders, meaning about 5,000 or more messages per day to a provider, must support RFC 8058 one click unsubscribe and honor it within 2 days | Secondary summaries of Google and Yahoo sender requirements in force since February 2024: courier.com blog, checked 2026-11-11, https://www.courier.com/blog/email-sender-requirements and 3mediaweb.com guide updated 2026-08-01, https://www.3mediaweb.com/blog/new-google-yahoo-bulk-email-requirements-now-in-effect/ | 2, confirm against Google's own sender guidelines page before building the rule |
| Spam complaint rate | Keep below 0.3 percent, target below 0.1 percent | Same secondary sources, checked 2026-11-11 | 2 |
| Authentication note | SPF, DKIM and DMARC required for bulk senders. The app cannot verify the user's DNS, so this rule renders as a checklist item with a link, not a hard block | Same secondary sources, checked 2026-11-11 | 2 |
| Frequency cap | No regulatory number exists. Default cap 4 marketing emails per customer per 7 days across all journeys, adjustable, labeled app policy not law | Inferred, judgment |  |
| Suppression and consent | Suppressed or unconsented records and active holdout controls are excluded from any audience export | App rule tied to the FTC opt out requirement above | 1 for the legal part |

Build risk: ledger schema and export, safe. Holdout engine with safeguards, moderate. A/A and planted lift harness, moderate. Evidence chain, safe. Compliance check, safe. Framework tags, safe. Inferred ratings.

---

## Section 9: AI plan

### 9.1 The four version 1 AI features

Cost per use is an estimate and labeled so; all picks stay inside free tiers, and every feature obeys the rules: hosted models get synthetic or public data only, real text runs in browser only, code computes every number, a number check rejects AI text containing numbers code did not produce, usage capped per session and per day, AI off switch, core app works with AI off.

| Feature | Task | Model tier | Input | Guardrail | Evaluation | Est. cost per use | Version |
|---|---|---|---|---|---|---|---|
| Column mapping suggestions | Suggest which uploaded columns map to the event model | Small hosted free model for demo data, in browser model for real files, or rules only fallback via header name matching | Column headers and 5 sample values per column, never full rows | User confirms every mapping, nothing auto applies | 20 seeded files, count correct suggestions | 0 dollars within free caps, roughly 1,000 tokens | 1 |
| Theme coding | Code open text into jobs, pains, gains with supporting quotes | In browser model for real text, hosted free model for the synthetic demo | Redacted comment text | Quotes must be exact substrings, checked by code; severity editable; association labels | 50 hand coded comments, report agreement as counts | 0 dollars, roughly 2,000 tokens per batch | 1 |
| Framework email drafts | Draft email copy in PAS, FAB or AIDA | Hosted free model, synthetic and user approved brand samples only, which the user pastes knowingly | Framework, segment profile built by code, brand voice samples | Marked AI generated, never sent by AI, compliance check runs after, number check strips invented numbers | Tester acceptance count out of drafts shown | 0 dollars, roughly 1,500 tokens | 1 |
| Grounded cited assistant | Answer questions from the user's own records with citations | In browser model for real data, hosted free model in the public demo on synthetic data | Retrieved rows and passages by id, question | Code verifies every cited id exists and every number came from SQL; refuses when retrieval is empty; promptfoo suite including planted injection tests | 20 known answer questions on both paths, report correct with citation as counts | 0 dollars, roughly 3,000 tokens | 1 |

Version 2 may add at most 2 AI features with your approval first; the current candidates are voice note transcription and nothing else committed. Inferred.

### 9.2 Hosted free model comparison and data use terms

The public demo default path is a hosted free model on synthetic data. Two candidates compared:

| Provider | Free tier exists | Trains on submitted content | Source and date |
|---|---|---|---|
| Google Gemini API free tier | Yes | Yes for unpaid services: Google uses content submitted to unpaid services to provide, improve and develop its products and machine learning technologies, and human reviewers may read API input and output | Gemini API Additional Terms of Service, ai.google.dev, terms text confirmed across the 2025 archived versions, checked 2026-11-11, https://ai.google.dev/gemini-api/terms | 1 |
| Groq free tier | Yes, accounts start on the Free tier | Groq states it does not retain prompts and context sent to its LLM APIs and does not train on your data | Groq privacy page, groq.com/privacy, checked 2026-11-11 | 1 |

Recommendation: Groq free tier as the default hosted model for the demo, because its stated policy is no retention and no training, and Gemini free tier as fallback, acceptable only because hosted paths receive synthetic or public data under this plan regardless of provider. Current rate limits for both must be read from their consoles in Week 1 before coding against them; I did not verify specific request per minute numbers and am not quoting any. Inferred recommendation on sourced terms.

**In browser model for real text.** WebLLM, Apache 2.0, or Transformers.js. Real customer text never leaves the device. The app shows model download size and device requirements before loading, labels small model output as lower quality, and switches AI off for real data when the browser cannot run a model, with the core app still working. The 20 question test runs on both the hosted path and the in browser path and both counts are reported. Sourced for license and approach from the approved tool menu researched 2026-11-01; model size numbers must be measured at build time, not assumed.

### 9.3 Redaction decision and runtime

**Decision in two lines.** Redaction runs in the browser in TypeScript, before any quote is stored, shown or written to the ledger, because that is the only runtime verified to exist in a TypeScript only version 1 and it keeps real text on the device. Presidio stays out of version 1: it is a Python library and no verified browser runtime for it was found, so claiming it would violate the no unverified runtime rule.

**What runs.**
- Rule based redactor, version 1, safe risk: regular expressions for email addresses, phone numbers, card like numbers with a Luhn check, street address patterns, plus column level rules that block known identity columns from ever reaching quote storage. Runtime: plain TypeScript in the browser, verified trivially since it is ordinary application code with no dependency.
- Name detection, stretch for version 1, moderate risk: a token classification model through Transformers.js. Quantized ONNX NER models for Transformers.js exist on Hugging Face, for example Xenova bert-base-NER and distilbert NER ONNX conversions, checked 2026-11-11, https://huggingface.co/Xenova/bert-base-NER . Download size varies by model and quantization and one multilingual quantized example lists about 178 MB, so the size must be measured and shown to the user before loading, and this layer ships only if a small enough model passes the seeded test. Sourced existence, unverified fit.
- Python worker with Presidio, version 2 option only, after a host with a verified free tier exists.

**Honesty and testing.** The interface states that no redactor finds everything and names are the hardest to catch. The user sees the redacted text and corrects it before anything saves. Seeded test: a generated set of 200 fake personal data items across the covered types, report caught and missed as counts per type, shipped on the methods page. A database constraint rejects quote rows without a redaction pass stamp, per section 6.4.

### 9.4 Where AI is not used and why

- Journey, pipeline, lift, power, SRM and all metrics: SQL in DuckDB, because numbers must be reproducible and checkable.
- Pre send compliance check: rules with sources, because a blocked send must point to the exact rule.
- Identity matching and dedupe: exact normalized email rules, per section 5.
- Weekly digest and metric tree in version 2: templates over computed numbers, by the prompt's own requirement.
- AI referral tagging in version 2: referrer and UTM rules.
- Plain-language names and profiles for customer groups, suggested journey outlines, and plain-language report summaries with a slide outline: not used in version 1. Each was dropped to stay within the prompt's limit of 4 AI features.
- Data quality warnings: computed checks with fixed plain wording, dropped as an AI feature to stay at 4.
- Personal information detection: rules first, optional local model, never a hosted model, since sending text out to find private text defeats the purpose.

---

## Section 13: Data flow, privacy and security plan

### 13.1 Two modes

**Public demo mode.** Runs entirely in the browser: Next.js static pages, DuckDB-Wasm over the seeded synthetic events, ledger in browser memory with file export and import, no login, no database call, hosted free model allowed because all data is synthetic. This is the recruiter path and it must work with the Supabase project paused or deleted. Resilience test from the build plan: pause the project on purpose and click through every demo screen.

**Pilot mode.** Accounts, saved projects and uploads in Supabase Free: Postgres, Auth with email sign in, row level security, storage. The interface states that the free database can pause and keeps the ledger export button always available. Real text AI stays in browser; hosted calls are blocked in pilot mode by a build time flag, with the redaction pass as backup layer.

**Storage decision.** Store pilot customer data, because the loop needs persistence across sessions, but under these controls: every table carries workspace_id, row level security policies check membership on every table, the Supabase service key exists only in server route handlers and never ships to the browser, quotes store only redacted text, and the raw email column is replaced at ingestion by a salted keyed hash per the section 5 identity decision, with the salt per workspace. A delete all my data control drops the workspace's rows and storage objects. Inferred design.

### 13.2 Keep alive result

- Supabase pauses Free plan projects after low activity over a 7 day period. Sourced: supabase.com docs, Project Pausing, checked 2026-11-11, https://supabase.com/docs/guides/platform/ . Restore window conflict: one current docs page states a 90 day restore window and another states up to 1 year; third party write ups quote both. Plan on the stricter 90 days. Sourced with conflict noted.
- Vercel cron on Hobby: allowed, at most once per day per job, timing guaranteed only within the hour, UTC expressions, and Vercel's changelog raised the job count to 100 per project on every plan in January 2026. Sourced: vercel.com docs, cron usage and pricing, checked 2026-11-11, https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing .
- Verdict: a free keep alive works. One Vercel Hobby cron job pings a lightweight pilot endpoint that performs one tiny database read, once per day, which beats the 7 day inactivity window with margin even if individual runs drift within their hour. Inferred conclusion from sourced limits.
- Backup scheduler: GitHub Actions schedule on the public repo, free on public repositories, but scheduled workflows are automatically disabled after 60 days without repository activity and runs can be delayed or dropped under load. Sourced: docs.github.com usage limits page, checked 2026-11-11, https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration . Use it only as the fallback, with a calendar note to commit at least every 45 days during quiet months.
- Inngest scheduled functions as keep alive: still unverified for this purpose, as the tool menu said; not relied on.
- A keep alive is not a backup. Supabase Free has no automatic backups, so the ledger export and import rule stands regardless, and the pilot interface nags gently when the last export is older than 14 days, threshold judgment.

### 13.3 Free limit behavior table

Rule for every row: no silent data loss, the ledger export always works, a usage meter in pilot settings warns at about 80 percent of any limit the app can measure.

| Limit | Verified number, source, date | What the user sees | What happens to data |
|---|---|---|---|
| Supabase database size | 500 MB on Free, per the approved tool menu researched 2026-11-01; re verify in dashboard Week 1 | Meter in settings, warning at 80 percent, at the cap uploads and new events switch to read only with a plain banner | Nothing is deleted. New webhook events are rejected with a retry later response and appear in the review list as deferred |
| Supabase project pause | Pause after 7 days low activity, sourced above 2026-11-11 | Pilot banner: project paused, demo unaffected, restore link, export still offered from the last local copy if one exists in the browser | Data persists on Supabase for the restore window, planned as 90 days; export nag exists to make even that loss path survivable |
| Resend monthly and daily send caps | 3,000 emails per month and 100 per day on the free plan, sourced: resend.com blog post announcing the free tier and resend.com pricing docs, checked 2026-11-11, https://resend.com/blog/new-free-tier | Not user facing in version 1 since version 1 sends nothing to customers; version 2 digest shows send status | Version 2 digest queues and retries next day when the daily cap is hit; nothing drops silently |
| Resend without a verified domain | The default onboarding at resend.dev sender delivers only to the account owner's own email address until a domain is verified; sending to anyone else returns a 403. Sourced: resend.com docs knowledge base, checked 2026-11-11, https://resend.com/docs/knowledge-base/403-error-resend-dev-domain | Settings states the digest can go only to your own address in this build | Resolves the open question from the tool menu: the version 2 digest to your own address works on the free plan with no domain purchase, which fits the no domain rule |
| Inngest free plan | 50,000 executions per month and 5 concurrent steps per the Inngest pricing page, which also lists 500,000 events ingested; some third party listings say 100,000 events, conflict noted, plan against the lower number. Function runs up to 30 days and sleeps up to 7 days on free, sourced: inngest.com docs usage limits, checked 2026-11-11, https://www.inngest.com/docs/usage-limits/inngest | Nothing until 80 percent, then a warning that approval waits may queue | Approval wait jobs past the cap queue in a pending table and resume next cycle; the 7 day sleep cap on free means approval waits longer than 7 days are implemented as event driven resumes, not sleeps, design note, inferred |
| Webhook rate limit | App enforced: 60 requests per minute and 256 KB payloads per section 5 | Sender receives a 429 with a retry after header; the review list shows deferred and rejected events with reasons | Nothing silently dropped |
| AI caps | App enforced per session and per day | AI buttons disable with a plain message at the cap | Core app keeps working; no data touched |
| Vercel Hobby usage limits | Per the approved menu researched 2026-11-01: exceeding Hobby limits blocks the feature for 30 days rather than billing; re verify in Week 1 | If the hosted app is blocked, the public demo must still open somewhere | Mitigation: the demo is a static export by design, so a mirror deploys free to GitHub Pages from the public repo; set up in version 1 week of launch, inferred plan, verify the static export constraint holds for every demo page |
| PostHog quotas | 1 million events per month per the approved menu researched 2026-11-01; error tracking limits are UNVERIFIED, see docs/2026-11-15-decision-error-tracking.md; re verify Week 1 | None; these are developer tools | At quota, analytics and error capture stop for the month; app behavior unchanged; anonymous events only, no session replay on data screens. Sentry is not used |

### 13.4 Security plan applied

From your pre launch checklist, the items that matter here, with judgment: service key server side only, secrets in environment variables and a secrets scan before the repo goes public, row level security on every table with a cross workspace read test in the suite, signed webhooks with timestamp window per section 5, input validation on every upload and endpoint, upload size and type restrictions, rate limits on auth and webhook routes, Turnstile on signup and upload forms, security headers and HTTPS by platform default on Vercel, dependency scanning through Dependabot once public, parameterized queries throughout since all SQL goes through bound parameters. Items from the checklist deprioritized for version 1 with reason: password hashing is delegated to Supabase Auth, cookie hardening follows Supabase defaults, and there is no payment surface. Inferred application of your checklist.

Privacy pages: a plain privacy policy and terms page stating the portfolio demo status, what pilot mode stores, the delete control, and that version 1 sends no email to customers. The email consent rules that apply when sending starts are the section 6.6 table.

---

## What is left

- Section 4: module table. Section 7: data source table. Section 8: ranked feature table. Section 10: tools and connectors table plus the Claude Code instructions file and Week 1 prompts. Section 11: design directions. Planned for Sonnet 5.5 as Part C.
- Section 12: go to market. Sections 14 to 19: feasibility and schedule, biggest weakness, validation plan, Week 1 tasks, version 2 roadmap, recruiter proof set. Planned for Sonnet 5.5 as Part D.
- Open items from you: attach the Marketing Value Playbook for sections 2.3 and 19, confirm the assignment export fix, choose visx or Mosaic after the spike decision, optionally set the 0 dollar monthly spend limit.
- Deferred verifications for Week 1: Google's own bulk sender guidelines page, Groq and Gemini current rate limits, Supabase dashboard numbers, Vercel Hobby limit behavior, ECharts image export into PptxGenJS, NER model download size.
