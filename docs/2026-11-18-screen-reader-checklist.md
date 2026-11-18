# Screen reader pass: a checklist for one person, about an hour

Written Wednesday November 18, 2026. This is the one accessibility check software cannot do. The automated scans (axe, keyboard, phone width) found nothing, and that does not show a screen can be used with a screen reader. Only listening does.

**Use NVDA, which is free, with Edge or Firefox.** Download it from nvaccess.org. If you have never used a screen reader: turn your monitor off or look away, so you test what it says and not what you can see. Stop NVDA with Insert+Q.

**Keys you need.** Next heading: H. Next table: T. Next button: B. Next form field: F. Next landmark: D. Read from here: Insert+Down arrow. List all headings: Insert+F7. Stop speech: Control.

Run it on the live site or on `npm run build` and `npm start`. Use the demo data and the synthetic loaders, never real data.

## For every screen

- [ ] The page title says which screen it is.
- [ ] Pressing H walks a sensible outline, one level 1 heading and the sections under it.
- [ ] The main navigation is announced as navigation, and the current screen can be told apart.
- [ ] Every button and field says what it does when you land on it, not just "button".
- [ ] Nothing important is only a picture or a color.

## Screen by screen

| Screen | What to try | It should say |
|---|---|---|
| Home `/` | Read from the top | What the app is, what works today, and the plain statement that it is untried on real data |
| Data intake `/intake` | Press F to the file field, then read the preview table after loading a small CSV | A labeled file field, a mapping row per column, a blocked column announced as blocked and why |
| Ledger `/ledger` | Load demo data, press T | A table named "Ledger entries" with a row per entry and a link into each |
| An entry | Open one, walk the headings, find the readout | Design, assignment and results as separate sections. A locked readout says why it is locked. A result reads as numbers with its interval, not just "significant" |
| Journeys `/journeys` | Load, press B on a filter, then T | Filter buttons say pressed or not pressed and carry their count. Every chart has a table with the same numbers. The new Around one event table reads step, event, customers |
| Around one event | Change the event, the steps and "events named per step" | Each control announces its state. The table updates, and the sentence "N of 100,000 customers did X" changes |
| Pipeline `/pipeline` | Load, pick a segment, open "How these numbers were worked out" | The same as journeys. An opened explanation reads as a list of label, value and how |
| Data check `/check` | Upload two small CSVs and a time file | Each file field has a name. Errors are announced as alerts. Results read as tables with a caption |
| Methods `/methods` | Read the tables | Each check reads with its counts |
| Privacy and Terms | Read from the top | Plain text, headings in order |
| 404 | Visit an unknown address | It says the page was not found and offers a link home |

## What to record

For each failure, write the screen, what you did, what NVDA said, and what you expected. A screenshot of the Speech Viewer (NVDA menu, Tools, Speech Viewer) is the easiest proof. Send them to me and I will fix them and add a test for each, so it cannot come back.

## What this does not cover

- Other screen readers (VoiceOver, JAWS, TalkBack). A pass in NVDA is a good sign, not a promise.
- People who use voice control or switch devices.
- Reading level. The text is written plainly but was not tested with readers.
