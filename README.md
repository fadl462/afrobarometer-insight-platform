# Afrobarometer Insight Platform — Ghana Round 10 (Prototype)

An interactive evidence intelligence platform built on Afrobarometer's Round 10
(2024) Ghana survey microdata — built as a technical proposal prototype, not
an official Afrobarometer product.

**Live locally:** open `site/index.html` in any modern browser, or serve the
`site/` folder with any static file server (no build step, no server-side
code, everything runs client-side):

```bash
cd site && python3 -m http.server 8000
# then open http://localhost:8000
```

## What this is

Rather than a static dashboard of pre-baked charts, this platform ships the
full respondent-level dataset (weighted, cleaned, de-identified of any
free-text fields) to the browser and computes every statistic — distributions,
regional comparisons, demographic cross-tabs, and rule-based policy
findings — on the fly, in response to the filters you choose. Every number is
traceable back to the underlying Afrobarometer microdata and its official
codebook.

### Modules
- **Executive Briefing** — headline KPIs, a rule-based insights feed, top
  citizen-named problems, and a regional/institutional snapshot.
- **Country Intelligence Centre** — sample composition, fieldwork details,
  and a narrative synthesis.
- **Indicator Explorer** — theme → indicator → live distribution, regional
  comparison, urban/rural split, and demographic breakdown, all filterable.
- **Demographic Intelligence** — build an arbitrary respondent segment (any
  combination of gender, setting, age, education, religion, employment,
  lived-poverty band) and compare it against the national average on any
  indicator.
- **Regional Intelligence** — a schematic 16-region grid (Ghana's regions,
  arranged roughly north-to-south / west-to-east) with click-to-filter detail.
- **Compare Countries** — an honest scaffold: this prototype ships with
  verified Ghana data only, so no other-country figures are fabricated. The
  underlying engine (indicator registry + respondent-level JSON schema) is
  written to be country-agnostic, so adding a second country's Round 10 file
  activates this view without further engineering.
- **Policy Insight Centre** — scans every indicator against five demographic
  splits and reports any gap at or above a chosen threshold, with the exact
  percentages and group labels driving each sentence (fixed rules over the
  weighted data, not generative text).
- **Methodology & Downloads** — sampling details, citation, weighting
  conventions, and export of the indicator registry / codebook reference.

## Data & provenance

- Source data: `GHA_R10.Data_03Oct24.wtd.final.release_updated.13Feb25.csv`
  (Afrobarometer Round 10, Ghana, n = 2,400, fieldwork 5–21 August 2024,
  CDD-Ghana).
- Value labels and question wording were cross-checked against
  **AB_R10.Codebook_Ghana_30June25.pdf** (Afrobarometer's official Ghana
  Round 10 codebook, prepared by Alfred Torsu, June 2025) — not the Round 9
  merge codebook, which uses different question numbering for several items.
- `etl.py` is the one-time transform from the raw labeled CSV export into
  `site/data/{records,indicators,meta,executive}.json`. It is included in
  this repo for transparency/reproducibility; it is not run in the browser.
- All percentages use the `withinwt_hh` weight Afrobarometer supplies to
  correct for individual selection probability. "Don't know", "Refused", and
  "Not applicable" responses are excluded from percentage bases.

## Citation

> Afrobarometer Data, Ghana, Round 10, 2024, available at http://www.afrobarometer.org.

Afrobarometer data are protected by copyright; this repository is a
technical prototype prepared for a proposal to Afrobarometer and is not
redistributing raw survey files — only the derived, respondent-level JSON
needed to power this specific demo.

## Stack

Vanilla HTML/CSS/JS, no build step. Chart.js and all web fonts are vendored
locally under `site/js/vendor/` and `site/fonts/` so the demo runs fully
offline (no CDN dependency at presentation time).
