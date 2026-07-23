# Afrobarometer Insight Platform — Ghana Round 10 (Prototype)

An interactive evidence intelligence platform built on Afrobarometer's Round 10
(2024) Ghana survey microdata — built as a technical proposal prototype, not
an official Afrobarometer product.

**Live locally:** open `index.html` in any modern browser, or serve the
repo root with any static file server (no build step, no server-side
code, everything runs client-side):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

**Live demo:** https://fadl462.github.io/afrobarometer-insight-platform/

## What this is

Rather than a static dashboard of pre-baked charts, this platform ships the
full respondent-level dataset (weighted, cleaned, de-identified of any
free-text fields) to the browser and computes every statistic — distributions,
regional comparisons, demographic cross-tabs, and rule-based policy
findings — on the fly, in response to the filters you choose. Every number is
traceable back to the underlying Afrobarometer microdata and its official
codebook.

### Modules
- **Executive Briefing** — headline KPIs (click any card to drill into that
  indicator), a rule-based insights feed, top citizen-named problems, and a
  regional/institutional snapshot (click any bar to drill in).
- **Country Intelligence Centre** — sample composition, fieldwork details,
  and a narrative synthesis.
- **Indicator Explorer** — theme → indicator → live distribution, regional
  comparison, urban/rural split, and demographic breakdown, all filterable.
  Every chart has a matching sortable data table; clicking a region bar
  re-filters the whole view to that region.
- **Demographic Intelligence** — build an arbitrary respondent segment (any
  combination of gender, setting, age, education, religion, employment,
  lived-poverty band) and compare it against the national average on any
  indicator.
- **Regional Intelligence** — a schematic 16-region grid (Ghana's regions,
  arranged roughly north-to-south / west-to-east) with click-to-filter detail;
  the ranked list is click-to-select too.
- **Compare Countries** — an honest scaffold: this prototype ships with
  verified Ghana data only, so no other-country figures are fabricated. The
  underlying engine (indicator registry + respondent-level JSON schema) is
  written to be country-agnostic, so adding a second country's Round 10 file
  activates this view without further engineering.
- **Policy Insight Centre** — scans every indicator against five demographic
  splits and reports any gap at or above a chosen threshold, with the exact
  percentages and group labels driving each sentence (fixed rules over the
  weighted data, not generative text). Each finding is clickable through to
  its indicator.
- **Ask the Data** — a floating assistant (available on every page) plus a
  dedicated Q&A Centre. Type a question in plain language ("Which region
  trusts the police least?", "Do young people use the internet more?") and
  a fixed-rule query engine (`js/qa-engine.js`) matches it against the
  indicator registry, detects any region/gender/age/education/lived-poverty
  terms in the question, and runs the exact same weighted-stats functions
  used everywhere else on the platform — so every answer is reproducible,
  not generated. The Q&A Centre also ships an auto-built FAQ (one entry per
  indicator, using its real survey-question wording as the prompt) plus five
  hand-authored cross-cutting questions.
- **Methodology & Downloads** — sampling details, citation, weighting
  conventions, and export of the indicator registry / codebook reference.

## Known limitations & roadmap

- **Single country today.** This build ships Ghana Round 10 only. Afrobarometer's
  actual Round 9 merged dataset covers 39 countries
  (`R9.Merge_39ctry.20Nov23.final_.release_Updated.4Jun25-3.sav`, from
  https://www.afrobarometer.org/data/merged-data/) and its accompanying
  merge codebook — both referenced during this build — but the raw `.sav`
  file itself was not available to fetch from the environment this prototype
  was built in. Supplying that file (or a CSV/Stata export of it) lets
  `etl.py` be extended with a `country` field and activates the Compare
  Countries / Africa Explorer views for real, without touching the frontend.
- **"Ask the Data" is a fixed-rule query engine, not a language model.** It
  fuzzy-matches question text against the indicator registry's labels and
  question wording, plus a small dictionary of region/gender/age/education/
  lived-poverty terms, then calls the same `weightedFavorable` /
  `groupFavorable` functions used elsewhere. It will not understand
  questions with no keyword overlap to the registry, and will say so rather
  than guessing.

## Data & provenance

- Source data: `GHA_R10.Data_03Oct24.wtd.final.release_updated.13Feb25.csv`
  (Afrobarometer Round 10, Ghana, n = 2,400, fieldwork 5–21 August 2024,
  CDD-Ghana).
- Value labels and question wording were cross-checked against
  **AB_R10.Codebook_Ghana_30June25.pdf** (Afrobarometer's official Ghana
  Round 10 codebook, prepared by Alfred Torsu, June 2025) — not the Round 9
  merge codebook, which uses different question numbering for several items.
- `etl.py` is the one-time transform from the raw labeled CSV export into
  `data/{records,indicators,meta,executive}.json`. It is included in
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
locally under `js/vendor/` and `fonts/` so the demo runs fully
offline (no CDN dependency at presentation time).
