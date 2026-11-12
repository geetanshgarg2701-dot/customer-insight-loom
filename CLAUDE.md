Project: evidence ledger, a free marketing test and decision tracker.
Rules:
- Cost must stay $0. Stop and ask before any step that could cost money. Never add a paid service. Ask before adding any dependency.
- Every number in the app comes from code, never from a model. Show the method.
- No secrets in code. Keys live in env files that git ignores. Never paste a key into chat.
- Write the test first for stats code. Pass the tests before moving to the next task.
- US English. No em dashes in any text the app shows.
- All user data stays in the browser by default. Redact before any AI call. Real customer text goes only to the in-browser model.
- Every AI output carries a visible label. Every statistic carries its method. Say association, not cause, unless a holdout supports it.
- TypeScript strict.
- Use DuckDB-Wasm in a Web Worker. Self-host wasm files. Aggregate before drawing.
- Use React Flow free examples only. Use elkjs for layout and keep its license notice, it is EPL-2.0 or GPL-3.0, not MIT.
- Look up library docs with Context7 before writing code against a library.
- Supabase tables need an organization identifier and row-level security before any data is stored.
- No Presidio, no sequential stopping, no live Google connectors in version 1.
- Commit small. Run gitleaks and semgrep before each push.
Models: Opus 5.5 at medium effort for stats and DuckDB modules. Sonnet 5.5 for the rest.
