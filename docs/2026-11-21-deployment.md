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

## The in-browser language model, checked on the live site, 2026-11-21

On the Comments screen, Load the model downloaded and started the model in the browser, which showed "The model is loaded in this tab." The two large files were the quantized model, 23 MB, and the runtime, 26.9 MB. Code 100 comments then ran: the model agreed with the generator's coded pain on 87 of 100 comments and was uncertain on none. That is in the same range as the 205 of 251 measured in the tests, and it is one run on synthetic comments, not a new measurement. Every request went to the one site, and nothing was stored in cookies, local storage or session storage.

## Not checked

- The first visit downloads about 35 MB of database files. The time to first load on a slow connection was not measured.
- Whether GitHub Pages compresses the wasm files is not known.

## A scanner false positive, and what was done

GitHub's push protection blocked the first publish to the built site, reporting a Mistral AI API key in `_next/static/chunks/3j5t779ze4ogu.js`. The match was the model name `Mistral3ForConditionalGeneration` in the Transformers.js library, which is 32 letters and digits right after the word Mistral. It is not a key. The owner marked it a false positive on GitHub, which lets that one string through for that repository. A later build with the same library string should not be blocked again, but a changed string could be.

## A second host: Vercel, live

https://customer-insight-loom.vercel.app , a project named customer-insight-loom in the owner's Vercel account, Marketing Hub, on the free Hobby plan. Created from the `main` branch on 2026-11-21 and built in 2 minutes.

`vercel.json` in the repository makes Vercel run the same static build as GitHub Pages, at the site root: `npm ci`, then `npm run build:static` with no prefix, serving `out/`. It sets no framework, so Vercel does not run its own Next.js server build, and the project's preset was set to Other. The build downloads the model files from Hugging Face during install, and checks each against a fixed SHA-256 before keeping it. No environment variables were added, and the Supabase integration offered at the end of the import was not added, so this site has no Account link and sends nothing.

Checked on the Vercel address, 2026-11-21:

- Home, Journeys, Ledger and Privacy answer 200, and an unknown address answers 404. The two database files and the model runtime are served as `application/wasm`, and the model file is served.
- On Journeys, Load synthetic journeys loaded 100,000 customers in 75 ms. The four number tiles read 100,000 customers, 16.3 percent reached Purchase, 26.4 percent used Search or Support, and most people stopped at Product, 33,792 people. These are the same figures as on GitHub Pages.
- On Comments, the model loaded and coded 100 synthetic comments, agreeing on 87 and uncertain on none, the same result as on GitHub Pages.
- Every request went to the one address, and nothing was stored in cookies, local storage or session storage.

How the two hosts update, which differs: Vercel rebuilds and redeploys by itself on every push to `main`. GitHub Pages serves the `gh-pages` branch, which is built and published by hand, as described above. So after a change to `main`, Vercel is current within minutes and Pages stays on the old build until it is published again.

Not checked: the Node version Vercel used, the Hobby plan's transfer limit of 100 GB a month against a first visit near 35 MB, and how long a first visit takes on a slow connection. The address `customer-insight-loom.vercel.app` is the project's main address. The other addresses Vercel makes for each deployment may sit behind Vercel's own login, which was not tested.

## Both sites current, 2026-11-21

After the four must-have features, the number tiles on Pipeline and the Ledger, and the restyled deck, the source was pushed to `main` at b5f1377, which Vercel rebuilt by itself, and the same build was published to `gh-pages` at b3a74ab by hand. `gh-pages` now holds only the built files and the licence; the old README that said the repository held only the built site was dropped, because the README on `main` is the one visitors see. Both sites were checked to serve the same new script file. On the live Vercel site, Load synthetic pipeline loaded 100,000 deals and the tiles read 14.1 percent reached Won, Proposal to Won as the hardest step with 41.1 percent going on, and 3,330 deals stalled for 30 days or more, the same figures a browser test works out from the generator. Not checked on the live sites: the health score and the idea picker, which are tested locally and in the full suite.
