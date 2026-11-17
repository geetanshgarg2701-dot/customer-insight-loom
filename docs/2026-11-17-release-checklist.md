# Release checklist

Written Tuesday November 17, 2026. This is what stands between the app as it is and a public link. Nothing here has been done for you. Publishing is the owner's decision, and some steps need a person.

Labels: SOURCED has a URL and the date I read it. INFERRED is my reasoning from sourced facts. UNVERIFIED means I did not confirm it.

## 1. What is ready

- The app builds as a static copy with one command, `npm run build:static`, and a browser test proves the copy works under a project prefix with no request to any other host. 73.5 MiB in 90 files.
- Automated accessibility checks, keyboard tests and a phone width test pass on every screen. See `2026-11-17-build-status.md`.
- Privacy and terms pages exist, and a test fails if the code starts using storage, cookies, network calls, outside addresses or an analytics package.
- The app says plainly that it is an early version, untried on real customer data, and that names are not removed.

## 2. Before a public link

| Step | Who | Why |
|---|---|---|
| A lawyer reads the privacy and terms pages | Owner | They are plain language drafting, not legal review. The terms limit liability, which is the kind of text that needs review. |
| A screen reader pass on the journeys and ledger screens | A person | Automated checks catch only part of the problems, and axe lists the rest as needing a person. |
| Decide how to handle the repository history | Owner | See section 3. |
| Decide the host | Owner | See section 4. |
| Add a license, or decide to publish without one | Owner | There is none. Without one, others have no right to reuse the code. |

## 3. The repository history

This repository is private. It returned 404 to an unauthenticated request on 2026-11-17. Its history holds personal details: a tracked document names a school in a message template. The personal plan parts are kept out of Git, but any commit made before that stays in history.

Three ways to publish, in the order I would choose:

1. **Publish only the built site.** Keep this repository private. Build with `npm run build:static`, and put the contents of `out/` in a separate new public repository that holds nothing else. The public repository then has no source history and no personal details. The site is the same.
2. **A fresh public repository with the current files only,** one new commit, no history. Check every file for personal details first.
3. **Rewrite this repository's history** to remove the details and make it public. This is the riskiest, because a missed copy stays public, and it breaks every clone. I would not choose it.

## 4. Hosting, with the limits that matter

| Host | Free for this? | What I found |
|---|---|---|
| GitHub Pages | Yes, for a public repository | SOURCED, `https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages`, 2026-11-17: Pages is available in public repositories with GitHub Free, and in private ones only with paid plans. SOURCED, `.../github-pages-limits`, 2026-11-17: a site up to 1 GB, a soft bandwidth limit of 100 GB a month, and not for a site mainly about commercial transactions or software as a service. This app's copy is 73.5 MiB. |
| Cloudflare Pages Free | Not as it stands | SOURCED, `https://developers.cloudflare.com/pages/platform/limits/`, 2026-11-17: the maximum size of one file is 25 MiB. The two DuckDB files are 32.7 and 37.5 MiB, so the app would not load. They could live in a separate store, but that adds a service and I did not check its free tier. |
| Vercel Hobby | For personal use only | SOURCED in the review of 2026-11-16, `https://vercel.com/legal/terms`: Hobby is for personal or non commercial use. The first visit downloads about 35 MB, so 100 GB covers roughly 2,900 first visits before a limit applies. Whether a pilot with outside marketers counts as commercial is UNVERIFIED. |

INFERRED: the best fit under a zero cost rule is GitHub Pages from a public repository, using option 1 in section 3. A project page needs the prefix, for example `npm run build:static -- your-repo-name`. A site named `your-name.github.io` has no prefix.

UNVERIFIED: that GitHub Pages serves `.wasm` files with the right content type, and whether it compresses them. Check both after the first deploy.

## 5. Publish, once decided

These are your steps, not mine.

1. Create the public repository for the built site.
2. `npm run build:static -- <repo name>`, or without a name for a site of its own.
3. Put the contents of `out/` in the repository, including the file `.nojekyll`, and turn on Pages for it.
4. Open the live link and check, in order:
   - the home page loads in the editorial style, and the icon is the ledger mark;
   - on `/ledger`, Load demo data works, and an entry opens;
   - on `/journeys` and `/pipeline`, Load works and a filter changes the charts;
   - the browser's network tab shows requests only to the same site, and the wasm file loads;
   - `/privacy` and `/terms` open, and an unknown address shows the 404 page.
5. Read the live site once as a stranger, on a phone.

## 6. What to say publicly

- It is an early, free version and has not been tried on real customer data.
- The charts and the demo use synthetic data.
- It does not remove personal names from text.
- Results are estimates with their uncertainty shown, not advice.

## 7. Cost guard

Nothing in the app needs a paid service, a card or an account. Confirm that each host's sign up does not ask for a card before you create the account, and stop if it does.
