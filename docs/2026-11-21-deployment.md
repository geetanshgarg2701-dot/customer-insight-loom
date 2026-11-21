# Deployment record

Written 2026-11-21.

## Where the app is live

https://geetanshgarg2701-dot.github.io/customer-insight-loom/ on GitHub Pages, from the public repository `customer-insight-loom`, branch `main`, root folder. Switched on by the owner on 2026-11-21.

## One repository, two branches

Since 2026-11-21 the source and the built site live in one public repository, `customer-insight-loom`, on two branches.

| Branch | Holds |
|---|---|
| `main` | The source code, tests, docs, SQL and history, with an MIT licence. |
| `gh-pages` | The built site only. GitHub Pages serves this branch, root folder. |

The source used to live in a private repository called `evidence-ledger`. It was moved on 2026-11-21 by pushing the source history to `main` of `customer-insight-loom` with a force push, after the built site had been copied to `gh-pages` and Pages switched to that branch, so the live site stayed up. A full history scan with gitleaks found no secrets before the source was made public. The three original planning documents, Parts A, C and D, are not in Git and were not published.

An earlier note in these docs said nothing was deployed and that no public site existed. That was wrong about the repository: a built copy already sat in `customer-insight-loom` with a README naming the live address, but Pages was switched off, so the address answered 404 until 2026-11-21.

## How a publish is done

1. Build: `npm run build:static -- customer-insight-loom` in the source folder. The prefix is the repository name, because a project page is served under `/customer-insight-loom/`.
2. Run `npm run check:site` and the mirror test, `MIRROR_PREFIX=customer-insight-loom PW_CHANNEL=msedge npm run test:static`.
3. Build with no `NEXT_PUBLIC_SUPABASE_URL` or key set, so the public site has no Account link and sends nothing. Check that no file holds the test project's address or key.
4. Clone the `gh-pages` branch of `customer-insight-loom` into a temporary folder outside the source folder, delete everything except `.git`, copy `out/` in, commit, push to `gh-pages`. Set `core.autocrlf` to false in that clone, so files are stored as built. The source on `main` is pushed separately, from the source folder.
5. The owner confirms before the push, since it changes a public repository.

## Checked on the live site, 2026-11-21

- Home, Journeys, Ledger and Privacy answer 200, and an unknown address answers 404.
- The two database files and the model runtime file are served as `application/wasm`, the model runtime script as `text/javascript`, and the model config as JSON.
- On Journeys, Load synthetic journeys loaded 100,000 customers in 191 ms in the browser, and the number tiles and charts drew. So the in-browser database works from Pages.
- Every request in that session went to the one site. No cookie, no local storage, no session storage.
- Thirteen console errors, all 404 for the optional prefetch files named `__next.<page>.__PAGE__.txt`. GitHub Pages cannot rewrite paths, so it cannot serve them. Pages and links still work, as the earlier mirror test showed.

## Not checked

- The in-browser language model on the Comments screen was not loaded on the live site. Its files answer 200 with the right types, but the roughly 51 MB download and the model running were not tried there.
- The first visit downloads about 35 MB of database files. The time to first load on a slow connection was not measured.
- Whether GitHub Pages compresses the wasm files is not known.

## A scanner false positive, and what was done

GitHub's push protection blocked the first publish to the built site, reporting a Mistral AI API key in `_next/static/chunks/3j5t779ze4ogu.js`. The match was the model name `Mistral3ForConditionalGeneration` in the Transformers.js library, which is 32 letters and digits right after the word Mistral. It is not a key. The owner marked it a false positive on GitHub, which lets that one string through for that repository. A later build with the same library string should not be blocked again, but a changed string could be.
