# Visual spec: a light, airy redesign

Date: 2026-11-21. Status: proposal only. No app code, dependency or test was changed to write it, and nothing was committed.

## How the labels work

Every claim carries one label.

- [SOURCED: link, date] means I opened that page on that date and found the statement in it.
- [SOURCED: local run, date] means I measured it on this machine with the project's own code or tools. There is no web address for a local run, so the command is named instead.
- [INFERRED] means it follows from evidence I have, but I did not test it directly.
- [SPECULATION] means a judgment call or a guess.
- [UNVERIFIED] means a claim I could not check.

Hex values, sizes and rules in Step 2 are design proposals, so they carry no label. Any statement of fact about them does. Rows in a table share the label given under the table or above it.

## Two corrections to the brief

1. The brief says to keep 710 unit tests and 59 browser tests passing. The repo now has more. The last full runs, on commit 8999fed, gave 1,343 unit tests passed with 1 skipped, and 159 browser tests passed. [SOURCED: local run of npx vitest run and npx playwright test, 2026-11-21] The build plan below holds all of them, not only the 710 and 59.
2. The brief asks for one doc only. The screenshots are evidence and are kept outside the repo, in the session scratch folder. That keeps this file as the only new file in the repo. [SOURCED: local run of git status, 2026-11-21]

## Step 1: the current design against the reference

### What was captured

Playwright in Microsoft Edge took 62 screenshots. They cover two targets, the live app at customer-insight-loom.vercel.app and the same commit run locally with the dev server, which is not the static export in the out folder. Each target was shot at widths 390, 820 and 1280. The pages were home on first load, home with the tour closed, ledger, an entry page reached through the demo ledger, journeys, pipeline, intake, methods and the 404 page. Journeys and pipeline were also shot after pressing Load. [SOURCED: local run of a Playwright script, 2026-11-21]

I compared live and local pixel by pixel on 8 pages at 3 widths. All 24 pairs had the same size. At most 1.31 percent of pixels differed, on the entry page at 390, and at most 0.16 percent elsewhere. [SOURCED: local run of an OpenCV comparison, 2026-11-23] The differences are likely the dev server badge and the entry timestamps. [INFERRED]

A second run on the live app added 6 screenshots of journeys and pipeline with charts loaded. [SOURCED: local run, 2026-11-23]

### What the reference shows

The reference images in docs/design-reference are phone video stills of a monitor, so color and text are not reliable. What they do show [INFERRED from the two images]:

- A soft gray white page with no hard edges and a faint mist.
- A tiny top nav, with a small mark on the left, five small text links in the middle and one small text link on the right.
- A large centered headline in three lines. The first two lines are heavy and dark. The last line is lighter in weight and in color.
- A short, small, gray subline under the headline.
- One dark pill button, small and solid, with nothing else competing.
- A hazy, faded picture at the bottom that melts into the page.
- No cards, no grid, no glow and no color accents at all.

### Where the current app conflicts with the reference

Each line below was seen in the screenshots and checked in the code.

1. The page is near black, #030303, where the reference is light gray white. [SOURCED: local run, src/app/globals.css line 11, 2026-11-21]
2. Green light beams sit at the top of every page, drawn as three blurred radial gradients. The reference has no light effects. [SOURCED: local run, src/app/globals.css lines 66 to 80, 2026-11-21]
3. A faint 64 pixel grid covers the whole page. The reference background is plain. [SOURCED: local run, src/app/globals.css lines 48 and 49, 2026-11-21]
4. The home headline is left aligned in two columns next to a 3D stack of glowing layers. The reference is one centered column. [SOURCED: local run, screenshots home-closed at 820 and 1280, 2026-11-21]
5. The headline uses a mint to white gradient on every line. The reference uses solid dark ink, with the last line lighter. [SOURCED: local run, src/app/globals.css line 814, 2026-11-21]
6. There are two green pill buttons, an outlined pill and a Take the tour pill in the hero, plus a green Try the demo pill in the nav. The reference has one dark pill. [SOURCED: local run, screenshot home-closed at 1280, 2026-11-21]
7. On first load the tour opens as a modal. At 390, 820 and 1280 its box overlaps the headline, the subline and the buttons, measured from their bounding boxes on the live app. [SOURCED: local run, 2026-11-23]
8. The nav is a blurred glass bar with filled green pills for the current group, a Reduce motion pill and a Try the demo pill. The reference nav is plain small text. At 390 the Reduce motion pill takes a second row under the brand. [SOURCED: local run, screenshots at 390 and 1280, 2026-11-21]
9. Below the hero, three cards sit in a row, and the first is a bright green gradient card. The reference has no cards. [SOURCED: local run, src/app/globals.css line 1066, 2026-11-21]
10. Every section on every screen is a dark glass card with a soft gradient fill and a border. Stacked boxes read heavier than the open space of the reference. [SOURCED: local run, src/app/globals.css line 416 and screenshot entry at 1280, 2026-11-21]
11. Glow shadows are used on buttons, the bright card and the hero layers. [SOURCED: local run, src/app/globals.css lines 453, 709, 885 and 1067, 2026-11-21]
12. Intake and the 404 page are mostly empty black space under a short top block, so the page feels unfinished rather than airy. [SOURCED: local run, screenshots intake and notfound at 1280, 2026-11-21]
13. Loading is slow on a first visit. On the live app, journeys took 19.6 to 20.2 seconds and pipeline took 13.4 seconds from the Load press to the first tiles. [SOURCED: local run at 3 widths, one load each, 2026-11-23] The page text says the update took about 0.2 to 0.4 seconds, so most of the wait is probably the first download and start of the in browser database. [INFERRED] Pipeline may have been faster because the download was already cached by journeys. [INFERRED]
14. The floating hero layers are not contained. At 820 they cover the Take the tour button and the top of two group cards. At 390 they touch the tour button. This is a defect, not only a style conflict. [SOURCED: local run, screenshots home-closed at 390 and 820, 2026-11-21]
15. The line by line mask clips the bottom of the letter g in Insight at 820. [SOURCED: local run, screenshot home-closed at 820, 2026-11-21]
16. Number tiles carry a colored top edge and sit in a row of four boxes. [SOURCED: local run, screenshots journeys-charts and pipeline-charts, 2026-11-23]

## The avoid list, and where the app breaks each item today

| Item to avoid | Broken today? | Where |
|---|---|---|
| Radial orbs | Yes | Three blurred radial beams on every page, src/app/globals.css lines 66 to 80. The hero layers also glow. |
| Dot grids | Yes | A dot pattern inside each hero layer, line 883, and a line grid over the page, lines 48 and 49. |
| Liquid glass | Yes | Blurred nav bar, lines 132 and 133. Blurred floating cards, lines 912 and 913. Glass gradient on every section, line 416. |
| Three feature cards in a row | Yes | The home group cards at 1280, .home-groups. At 820 they show as two across. The three hero stats also read as a row of three. |
| A colored left stripe | Yes | Status messages get a 3 pixel mint stripe, line 592. Alerts get a 3 pixel red stripe, line 587. The loading skeleton inherits the status stripe. |
| Harsh gradients | Yes | Gradient headline text, line 814. Black to green card, line 1066. Glowing hero layers, line 884. |
| Neon | Yes | Mint glow shadows on buttons, lines 453 and 709, and on the hero, lines 885 and 1067. |
| Pure white backgrounds | No | No page or panel uses #FFFFFF as a background. The range dot fill is #FFFFFF, line 1297, and the headline gradient ends in #FFFFFF. The app breaks the opposite way, with a near black page. |
| Emojis | No | A scan of src found no emoji or pictograph characters. [SOURCED: local run of a Python scan, 2026-11-21] |
| Sparkle icons | No | No sparkle icon or sparkle text in src/app. [SOURCED: local run of grep, 2026-11-21] |
| Bento grids | Partly | No mixed size bento layout, but the hero stats, the home cards and the number tiles are all boxed grids. |
| Purple on black | No | The accent is green on black, not purple. The mood is close, though, with a bright accent on black. |
| Inter, Geist, Space Grotesk | No | The font stack is system-ui, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue and Arial, line 28. There is no font file and no next/font import. [SOURCED: local run of grep, 2026-11-21] |

All line numbers are from src/app/globals.css at commit 8999fed. [SOURCED: local run of grep, 2026-11-21]

## Step 2: the visual spec

### Principles taken from the reference

These are principles, not a copy. The headline, text, photo and exact layout of the reference are not used.

1. Light and quiet. One soft gray white field, with no orbs, glows, grids or glass.
2. One voice per screen. One large headline on home, set by weight and color contrast, not by color effects.
3. One action. A single dark pill is the only primary button style in the app.
4. Small chrome. The nav is small text, so the content leads.
5. A soft picture from real data. The hazy visual at the bottom of home is a faded chart of this app's own synthetic journeys, not a photo.
6. Space instead of boxes. Sections are separated by space and hairlines, not by stacked cards.

### Color tokens, light, the main look

The page is a soft gray white, never pure white. Raised panels are a step lighter, also not pure white.

| Token | Hex | Use |
|---|---|---|
| canvas | #ECEDEF | Page background |
| surface | #F5F5F6 | Panels, menus, the tour card, chart backgrounds |
| sunken | #E3E5E8 | Table headers, code, disabled fields |
| ink | #15171B | Headings, body text, the dark pill |
| ink-2 | #3E434B | Secondary text, nav links, axis labels |
| muted | #585E68 | Sublines, captions, help text |
| headline-light | #5A6270 | The lighter last line of the home headline |
| accent | #1D5E47 | Links, focus ring, selected state |
| chip-bg | #DCE8E2 | Pressed toggle background |
| note-bg | #E2EAE6 | Status note background, replacing the left stripe |
| danger | #9B1C1C | Error text |
| danger-bg | #F6E4E4 | Error background, replacing the left stripe |
| on-pill | #F5F5F6 | Text on the dark pill |
| pill-hover | #2A2D33 | Dark pill on hover |
| control-line | #7D838C | Borders of inputs, selects and outlined buttons |
| line | #D3D6DB | Decorative hairlines between sections |

### Contrast, light

Every text color against every background, computed with the WCAG relative luminance formula. [SOURCED: local run of fix-spec.py, 2026-11-23] Text needs 4.5 to 1. [SOURCED: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html, 2026-11-23] Control edges and meaningful graphics need 3 to 1. [SOURCED: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html, 2026-11-23]

| Text | canvas #ECEDEF | surface #F5F5F6 | sunken #E3E5E8 | chip-bg #DCE8E2 | note-bg #E2EAE6 | danger-bg #F6E4E4 |
|---|---|---|---|---|---|---|
| ink #15171B | 15.32 | 16.47 | 14.22 | 14.26 | 14.65 | 14.64 |
| ink-2 #3E434B | 8.50 | 9.14 | 7.89 | 7.91 | 8.13 | 8.12 |
| muted #585E68 | 5.57 | 5.99 | 5.17 | 5.19 | 5.33 | 5.33 |
| headline-light #5A6270 | 5.25 | 5.64 | 4.87 | 4.88 | 5.02 | 5.02 |
| accent #1D5E47 | 6.53 | 7.02 | 6.06 | 6.08 | 6.25 | 6.24 |
| danger #9B1C1C | 6.96 | 7.48 | 6.46 | 6.48 | 6.65 | 6.65 |

Every pair passes. Two more pairs: on-pill #F5F5F6 on the pill #15171B is 16.47, and on pill-hover #2A2D33 is 12.67.

| Interface edge | On | Ratio | Result at 3 to 1 |
|---|---|---|---|
| control-line #7D838C | surface #F5F5F6 | 3.51 to 1 | pass |
| control-line #7D838C | canvas #ECEDEF | 3.26 to 1 | pass |
| accent focus ring #1D5E47 | canvas #ECEDEF | 6.53 to 1 | pass |
| dark pill #15171B | canvas #ECEDEF | 15.32 to 1 | pass |

The hairline #D3D6DB on canvas is only 1.24 to 1. That is allowed because it only decorates and never marks a control or carries meaning. [INFERRED from WCAG 1.4.11, which covers only what is needed to identify a control or understand a graphic] Inputs and outlined buttons must use control-line, never line.

### Dark mode: keep it, as a second look

Recommendation: keep a dark mode, but only as a follow-the-system second look, and rebuild it in the same quiet style. [SPECULATION about what users prefer; the reasons below are INFERRED]

- People who read charts in dim rooms may set their system to dark. [SPECULATION] The prefers-color-scheme media feature has been available across browsers since January 2020, so following it costs no setting and no storage. [SOURCED: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme, 2026-11-23]
- A dark look already exists and is tested, so removing it throws away work. But the current dark look breaks the avoid list, so it must lose the beams, grid, glass and glow too.
- Cost: every axe check must run twice, once per color scheme. That is the main reason not to add a manual light and dark switch now. A switch would also be lost on reload, because the app stores nothing.

Dark tokens, computed the same way. [SOURCED: local run of fix-spec.py, 2026-11-23]

| Text | canvas #0E1012 | surface #16191C | sunken #1D2125 | chip-bg #1E3A30 | note-bg #18261F | danger-bg #2B1517 |
|---|---|---|---|---|---|---|
| ink #ECEEF0 | 16.39 | 15.17 | 13.93 | 10.60 | 13.52 | 14.77 |
| ink-2 #C9CDD2 | 11.93 | 11.05 | 10.14 | 7.72 | 9.84 | 10.76 |
| muted #A3A9B1 | 8.05 | 7.45 | 6.84 | 5.21 | 6.64 | 7.25 |
| headline-light #A9B1BD | 8.82 | 8.16 | 7.49 | 5.70 | 7.27 | 7.94 |
| accent #7FD1B4 | 10.60 | 9.82 | 9.01 | 6.86 | 8.74 | 9.56 |
| danger #FF9C9C | 9.52 | 8.81 | 8.09 | 6.16 | 7.85 | 8.58 |

The pill is #ECEEF0 with text #0E1012 at 16.39, and its hover is #C9CDD2 at 11.93. control-line #6E757E is 3.79 on surface and 4.09 on canvas. line is #2A2F34, decorative only.

The dark canvas is #0E1012, not pure black. In dark mode the one pill flips to light with dark text, so it stays the single strongest element.

### Type scale, system fonts only

No font file is added. The stack stays as it is today: system-ui, then Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue and Arial. system-ui uses the operating system interface font, commonly Segoe UI on Windows, San Francisco on Apple devices and Roboto on Android. [UNVERIFIED: seen only in a search summary] For the home headline only, Segoe UI Variable Display is placed first, with system-ui after it.

| Role | Size | Weight | Line height | Tracking | Color |
|---|---|---|---|---|---|
| Home headline, dark lines | at least 2.5rem, growing with the screen to at most 4.5rem | 600 | 1.05 | minus 0.03em | ink |
| Home headline, light last line | same as above | 300 | 1.05 | minus 0.03em | headline-light |
| Home subline | 1.0625rem | 400 | 1.55 | 0 | muted, at most 46 characters wide |
| Page title, h1 on other screens | 2rem | 600 | 1.15 | minus 0.02em | ink |
| Section title, h2 | 1.25rem | 600 | 1.3 | minus 0.01em | ink |
| Sub title, h3 | 1.0625rem | 600 | 1.35 | 0 | ink |
| Body | 1rem | 400 | 1.6 | 0 | ink |
| Secondary body | 1rem | 400 | 1.6 | 0 | ink-2 |
| Nav links | 0.8125rem | 500 | 1 | 0.01em | ink-2 |
| Captions and help | 0.875rem | 400 | 1.5 | 0 | muted |
| Numbers in tables and tiles | as their role | as their role | as their role | 0 | tabular figures |

How the reference feel comes without a new font [INFERRED]: the dark lines are weight 600 in ink at 15.32 to 1, and the last line is weight 300 in headline-light at 5.25 to 1. Two signals carry the change, weight and color, so the effect holds even where a system font has no 300 face and falls back to 400. Segoe UI ships Light and Semibold faces. [SOURCED: https://learn.microsoft.com/en-us/typography/font-list/segoe-ui, 2026-11-23] Mac and Android faces were not checked. [UNVERIFIED] Body text never drops below 1rem, and no text in the app is set below 0.8125rem.

### Spacing

A 4 pixel base. Tokens: 4, 8, 12, 16, 24, 32, 48, 72 and 112 pixels.

- Page side gutter: 16 at 390, 32 at 820, 48 at 1280.
- Reading width: 68 characters for running text. Wide content, such as tables and charts, may run to 72rem.
- Space between sections on home: 112 at 1280, 72 at 820 and 390.
- Space between sections inside a screen: 48. Inside a section: 16 to 24.
- Sections are separated by space and a single hairline, not by a box. A box is kept only for things that float, such as menus and the tour card, and for the tables and charts that need a frame.

### Radius

- Buttons and toggles: fully round pill ends.
- Inputs and selects: 10 pixels.
- Menus, the tour card and chart frames: 16 pixels.
- The faded hero chart: 24 pixels, only if it has a frame at all.
- A border on one side only gets no radius.

### Buttons

- Primary: the dark pill. Background ink, text on-pill, weight 600, 0.9375rem, height 44, side padding 22. Hover pill-hover. Focus: a 2 pixel accent outline, 3 pixels away. It is the only primary style in the app.
- At most one dark pill is visible in any one screen region. On home, that is Start with the ledger. In the nav there is no pill.
- Secondary: an outlined pill, transparent, with a control-line border and ink text. It is never filled with color.
- Tertiary: a text link in accent with an underline.
- Toggles and chart filters: small outlined pills. When pressed, the background is chip-bg, the text and border accent, and aria-pressed is true.
- Destructive: an outlined pill with danger text and a danger border.
- No button has a glow, a gradient or a shadow.

### Nav design

- A plain bar 56 pixels high, on canvas, with one hairline below it. There is no blur and no glass. It stays at the top on scroll.
- Left: the mark at 20 pixels and the name at 0.9375rem, weight 600.
- Middle, from 900 pixels up: Home, Experiments, Customers, Your data and Methods, as small text at 0.8125rem, weight 500, in ink-2. The current item is ink with a 2 pixel accent underline. That is a bottom line, not a left stripe.
- The groups still open as small menus. A menu is a surface panel with a hairline border, a 16 pixel radius and a soft shadow of ink at 8 percent, 12 pixels down and 32 pixels wide. It is not glass.
- Right: Try the demo as a small text link, and the Reduce motion switch as a small text toggle with aria-pressed. Neither is a pill.
- Below 900, so at 390 and 820: the mark, the name and a Menu text button on one line. Reduce motion moves into the open menu, so it no longer takes its own row.

### Home hero design

One centered column, at most 46rem wide, with 112 pixels of space above at 1280 and 56 at 390.

1. Headline in three lines, written for this app. The text is my proposal and can change:
   - Line 1 and line 2, dark, weight 600: Customer Insight Loom shows if your campaign really worked
   - Line 3, light, weight 300: or if luck did the work.
   The h1 keeps the words Customer Insight Loom at its start, so the tests that find the h1 by that name still pass. [INFERRED from how Playwright matches names, which is by substring unless exact is set]
2. Subline, two short lines in muted: Plan the test, hold back a control group, and read one result with its range. Your files never leave this tab.
3. One dark pill: Start with the ledger. Beside it, one text link: Explore journeys.
4. The hazy visual, at the bottom of the hero. It is a soft chart drawn from the app's own synthetic journeys. It is not a photo.

### The faded journey chart, the hero visual

- Data: the four step counts of the 100,000 synthetic customers that the Journeys screen uses, which are 100,000 visits, 69,311 products, 35,519 carts and 16,294 purchases. [SOURCED: local run of syntheticJourneys with 100,000 rows and seed 11, 2026-11-21] They equal the counts on the live Journeys canvas. [SOURCED: local run, 2026-11-21] Generating them takes about 0.5 seconds, so they can be worked out once at build time and written into the page as numbers. [SOURCED: local run, 2026-11-21] This keeps the rule that every number comes from code.
- Drawing: one soft area in accent that steps down left to right through the four counts. It is inline SVG made at build time, so home needs no chart library and makes no request.
- Haze: only the shape fades, with a vertical CSS mask from fully visible at 40 percent of its height to transparent at the bottom. mask-image has been available across browsers since December 2023. [SOURCED: https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image, 2026-11-23] Without support the shape shows unfaded, which is still correct.
- Text stays outside the mask. Step names and counts sit in a row below the shape in muted at full strength, 5.57 to 1 on canvas. A faded shape falls below 3 to 1, so the numbers must never depend on it.
- Honesty: a small caption in muted under the chart reads Synthetic example from the demo data. The figure has a text label that gives all four counts in one sentence for screen readers.
- Size: 100 percent of the column, at most 64rem wide, 320 pixels high at 1280 and 200 at 390.

### Below the hero

The three group cards in a row are replaced by one ruled list titled Where to start. Each group is one row: the group name in a left column of 12rem, then its screens as links, each with one line of muted description. Rows are separated by hairlines. At 390 the group name sits above its links. The privacy note follows as plain text, with no box.

### Rule for the product tour

The tour must never cover the headline, the subline or the dark pill on first load. The current app conflicts with this, see Step 1 item 7.

- It never opens as a modal on page load.
- On a first visit, a small non modal hint shows below the hero action row: New here? Take the 2 minute tour. It is a text button, not a pill, and it disappears once the tour has been opened or dismissed in this tab.
- The tour opens only when the person asks. When it is open it stays a modal, as today, so focus is kept inside it and Escape closes it.
- A browser test checks, at 390, 820 and 1280, that on first load no dialog is open and the headline, subline and pill are fully visible and not covered.

### Chart colors for ECharts, the canvas and the range picture

Built from the Okabe and Ito palette, which was designed to stay distinct for color blind readers. [SOURCED: https://jfly.uni-koeln.de/color/ for the purpose and https://siegal.bio.nyu.edu/color-palette/ for the hex values, 2026-11-23] Several originals are too light for a light page. Orange is 2.07 to 1, sky blue 2.12, yellow 1.21 and reddish purple 2.81 on surface, all below the 3 to 1 needed for chart marks. [SOURCED: local run of tokens-check.py, 2026-11-21] So the light set uses four hues, darkened where needed.

| Series | Hex | On surface #F5F5F6 | On canvas #ECEDEF |
|---|---|---|---|
| 1, blue | #0072B2 | 4.76 to 1 | 4.43 to 1 |
| 2, vermillion | #C4510A | 4.26 to 1 | 3.96 to 1 |
| 3, bluish green | #007A5A | 4.90 to 1 | 4.56 to 1 |
| 4, reddish purple | #A64B87 | 4.85 to 1 | 4.51 to 1 |
| Neutral only, gray | #6B7079 | 4.57 to 1 | 4.25 to 1 |

Color blind check. I simulated protan, deutan and tritan vision with the Machado, Oliveira and Fernandes 2009 model at severity 1.0. All 27 matrix values match the table on the authors' page. [SOURCED: https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html, 2026-11-23] The difference is the plain CIE Lab distance, where a larger number is easier to tell apart. Treating 10 as the floor is a judgment. [SPECULATION]

| Vision | Smallest difference among the four series | Closest pair |
|---|---|---|
| Typical | 54.0 | blue and reddish purple |
| Protan | 16.3 | blue and reddish purple |
| Deutan | 18.8 | bluish green and reddish purple |
| Tritan | 10.9 | blue and bluish green |

[SOURCED: local run of tokens-check2.py, 2026-11-21]

Rules from these results:

- At most four colored series in one chart. A fifth color failed: a dark amber was almost the same as vermillion for protan vision, a difference of 1.0. [SOURCED: local run, 2026-11-21]
- Gray is never a series color. With gray as a fifth series, it came out almost the same as reddish purple for deutan vision, a difference of 5.9. [SOURCED: local run, 2026-11-21] Gray is only for a neutral baseline, and always drawn dashed.
- The closest pair, blue and bluish green for tritan vision, clears that floor only just. So the series name is always printed next to its color, as the app does today, so color is never the only signal.
- Groups keep one color everywhere. new is blue, returning bluish green, vip vermillion. ads is vermillion, email bluish green, organic reddish purple.
- Axis text ink-2, grid lines line, chart background surface. Bars glide on change with no bounce.
- The range picture: above zero uses bluish green, below zero vermillion, spanning zero uses ink-2 with a dashed outline. The lift dot is surface with a 3 pixel ink border.
- The dark set: sky blue #56B4E9, orange #E69F00, bluish green #2EB38C and reddish purple #D08AB5 on #16191C, at 7.65, 7.84, 6.68 and 6.71 to 1. The smallest differences are 17.4 protan, 15.6 deutan and 10.5 tritan. [SOURCED: local run of tokens-check2.py, 2026-11-21]

### How each screen changes

Two lines per screen.

**Home**
- The glass hero becomes one centered column with a three line headline, one dark pill and the faded journey chart.
- The three cards become one ruled list, and the tour opens only on request.

**Ledger**
- The form and the entries table sit on canvas, split by space and a hairline.
- The tiles become plain figures with labels, and Create draft is the one pill.

**Entry page**
- The boxed sections become one reading column with h2 titles and hairlines.
- The range picture uses the light chart set, and its sentence still states the result.

**Journeys**
- Charts use the four color set on surface frames, and tiles lose their colored top edge.
- Canvas nodes become surface boxes with ink text, and the loading shapes turn light gray.

**Pipeline**
- Filters become one compact row of outlined toggles above the charts.
- The stalled table sits on canvas with sunken headers and the same chart rules as Journeys.

**Comments**
- The theme ranking becomes hairline rows, with quotes in ink-2.
- The evidence chain keeps its order, with surface nodes and no dark boxes.

**Data intake**
- The file field gets a control-line border so it reads as a control.
- One muted line says what happens next, so the empty space reads as calm.

**Data check**
- The file fields and the zone choice line up in one column on canvas.
- Flagged rows use a note-bg panel with no left stripe.

**Email check**
- Rule rows become a hairline list with the source in muted text.
- A failing row uses danger text and the word fail, so color is not the only sign.

**Email drafts**
- The form sits on the left and the draft on a surface sheet on the right, stacked at 390.
- Approve is the one pill, and the AI label stays in plain view.

**Webhooks**
- The sandbox form uses outlined inputs on canvas with one pill to send.
- The reply shows on sunken in the mono font.

**Your data**
- Memory use becomes one figure and a thin ink bar.
- Delete everything is an outlined danger button, never the pill.

**Methods**
- Tables sit on canvas with sunken headers and tabular figures.
- Sections are split by space, not boxes.

**Account, pilot build only**
- The sign in form is one narrow centered column with one pill.
- Status notes use note-bg with no left stripe.

**Privacy**
- One centered reading column at 68 characters.
- Headings use the h2 style with no boxes.

**Terms**
- Same reading column as Privacy.
- The last updated line uses muted.

**404**
- A short centered headline in the home style, with the lighter last line.
- One dark pill leads home.

### Motion rules

- Purpose only. Motion is used to show a change of state, to show where something came from, or to reveal the home headline once. Nothing moves in a loop except a loading shimmer.
- Durations: 120ms for hover and press, 200ms for menus, 320ms for value changes, 600ms at most for the home reveal. Easing is an ease out curve with control points 0.2, 0.7, 0.2 and 1. Nothing bounces, because a bounce overshoots and misstates a value.
- Only opacity and transform are animated, never layout.
- The home reveal plays once per page load: the headline lines rise in turn, then the faded chart fades in over 600ms. The floating stack, drifting cards, beams and counting numbers are removed.
- The loading shimmer is slow, at least 2.4 seconds per pass, and low in contrast.
- Reduce motion: the app follows both the system setting and the Reduce motion switch. In CSS that is the prefers-reduced-motion query plus the data-motion attribute on the root element. In script it is the useReducedMotion hook. Under either, every animation and transition is off and every element shows in its final state at once. WCAG lists the query as a technique and asks that motion from interaction can be turned off. [SOURCED: https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html and https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html, 2026-11-23] The switch is kept in the page only and resets on reload, because the app stores nothing.

## Step 3: build plan, steps 2 to 5

Step 1 is this spec. Each later step ends with the same gate:

- npx tsc --noEmit
- npx eslint src e2e, with no new warnings
- npx vitest run, with all 1,343 unit tests passing, which includes the 710 named in the brief
- npx playwright test in Edge, with all 159 browser tests passing plus any new ones, which includes the 59 named in the brief
- npx playwright test -c playwright.pilot.config.ts, so the pilot build still passes
- A test whose expected value is an old color, animation or tour behavior is updated in the same step. No test is deleted or skipped to make a step pass
- npm run build:static with the customer-insight-loom prefix, then npm run check:site and the mirror test
- package.json and package-lock.json unchanged, so no dependency is added
- The privacy test in src/lib/app/privacy-claims.test.ts still passing, which keeps the static export free of requests to another host

### Step 2: tokens, base elements, nav and dark mode cleanup

- Files: src/app/globals.css for tokens, body, sections, buttons, inputs, tables, alerts, status notes, tiles, nav, menus and the prefers-color-scheme dark block. Also src/app/nav.tsx for the text style nav and moving Reduce motion into the phone menu, src/app/motion-switch.tsx for the text toggle style, and src/app/icon.svg so the mark matches the new accent.
- Removed: the beams, the page grid, the glass blur, the glow shadows and both left stripes.
- Tests that must change, with the reason: e2e/layout.spec.ts and e2e/pages.spec.ts check the page and nav background colors and the icon color, so they get the new values. e2e/menu.spec.ts and e2e/interactive.spec.ts check the nav entry animation, drop-in, which is removed here.
- New tests: an axe run on every page in both color schemes, using Playwright's color scheme emulation. Also a check that no element on home has a backdrop filter.

### Step 3: the home hero, the faded chart and the tour rule

- Files: src/app/page.tsx for the hero and the ruled list. src/app/guided-tour.tsx so the tour no longer opens on load and gets the hint. A new src/lib/app/hero-funnel.ts that works out the four step counts from syntheticJourneys, with its unit test src/lib/app/hero-funnel.test.ts. A new src/app/hero-funnel.tsx that draws the SVG at build time. And src/app/globals.css.
- Tests that must change: e2e/tour.spec.ts, because the tour no longer opens by itself. e2e/menu.spec.ts and e2e/interactive.spec.ts have an openHome or closeTour helper that expects the tour on load. e2e/home.spec.ts checks the group cards, which become the ruled list. Only those three specs use the dialog or Escape. [SOURCED: local run of grep over e2e, 2026-11-23]
- New tests: the hero funnel counts equal a direct count of the generator. On first load at 390, 820 and 1280 no dialog is open, and the headline, subline and pill bounding boxes are fully in view and not overlapped. The faded chart has a text label with all four counts.

### Step 4: charts and the remaining screens

- Files: src/app/journeys/theme.ts for the light and dark series sets, text, line and fill colors. src/app/journeys/page.tsx for the boxplot fill, which already reads the theme. src/app/journeys/canvas.tsx and src/app/insights/chain-graph.tsx for node colors from the theme. src/app/interval-plot.tsx for the range tones. src/app/ledger/entry/revenue-panel.tsx, src/app/skeleton.tsx and src/app/globals.css for screen styles.
- Tests that must change: any spec that reads a chart or node color. None does today. Only e2e/layout.spec.ts and e2e/pages.spec.ts read colors, and Step 2 updates both. [SOURCED: local run of grep over e2e and src tests, 2026-11-23]
- New tests: a unit test that each light series color is at least 3 to 1 on surface and canvas, and that the four series stay apart under the three color blind simulations, using the same numbers as this doc.

### Step 5: motion cleanup, docs and final checks

- Files: src/app/globals.css to remove the floating stack, the drifting cards, the counting numbers and the hover lift, and to set the motion durations above. src/app/page.tsx to drop the stack markup. Plus docs/2026-11-17-build-status.md, docs/2026-11-18-knowledge-file.md and README.md to describe the new look.
- Tests that must change: e2e/menu.spec.ts and e2e/interactive.spec.ts check the names of the removed animations, layer-in, drop-in and count-up. They are rewritten to check the new headline reveal and that everything is still under Reduce motion.
- Final checks: the full gate above, plus screenshots at 390, 820 and 1280 of the same nine pages, compared by eye with the reference principles and the avoid list.

## Risks and open questions

- The headline weight 300 may render as 400 on some systems. The color step still carries the contrast. [INFERRED]
- The first load of about 13 to 20 seconds is the largest drag on how the app feels, and no color change fixes it. Measuring the cause is worth its own task.
- The reference has far less content than any screen in this app. The calm look will be strongest on home and weaker on dense screens such as the entry page. [INFERRED]
- Owner decisions: keep dark mode as a follow-the-system second look, as recommended, or drop it. Approve the headline text. Confirm that no font file is wanted, which this spec assumes.

## Sources opened on 2026-11-23

- https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html
- https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme
- https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image
- https://jfly.uni-koeln.de/color/
- https://siegal.bio.nyu.edu/color-palette/
- https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
- https://learn.microsoft.com/en-us/typography/font-list/segoe-ui
