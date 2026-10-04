# Release Schedule Planner

Plan release trains, share the dates, export to your calendar.

Visit: [www.rail.sh](https://www.rail.sh)

## What it does

Pick a first GA date and a cadence, list the milestones that lead up to each release, and the planner lays out every release on a timeline and in a table.

- **Milestones** are offsets from GA: "Branch cut −6 weeks", "RC1 −4 weeks", "First patch +2 weeks".
- **Release names** come from a template. `{YYYY}`, `{YY}`, and `{MM}` come from the GA date, `{N}` is the nth release that year, and `{SEQ}` is a running number. Edit a name in the table to override it.
- **Presets** cover an RC train, a calendar-versioned biannual release, and a simple monthly release.

## Date rules

A date that lands on a weekend or inside a blackout (a holiday freeze, say) moves to the nearest earlier working day. Moved dates are marked ↶ with the original date and the reason. Dates are calendar dates, so your timezone never shifts them.

## Sharing and exports

- **Copy link**: the whole schedule lives in the URL, so a link reproduces it exactly. Nothing is stored on a server.
- **Download .ics**: every milestone becomes an all-day calendar event. As long as the first GA date stays the same, re-importing an updated schedule updates the same events in calendars that support it.
- **Copy as Markdown**: a table ready for a GitHub issue, a wiki page, or Slack.

## Development

Plain HTML, CSS, and JavaScript modules. No dependencies, no build step.

- `planner.js`: schedule math, validation, link encoding, .ics and Markdown output (no DOM)
- `app.js`: the page
- `test/planner.test.js`: tests for `planner.js`

Run the tests (Node 24+):

```bash
npm test
```

Preview locally. ES modules need HTTP, so opening `index.html` directly won't work:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

---

Made by [@rail](https://github.com/rail)
