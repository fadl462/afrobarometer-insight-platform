# Afrobarometer Insight Platform — 39-Country Round 9 Build

An interactive evidence intelligence platform built on Afrobarometer's real
**Round 9 Merged Data** — 53,444 interviews across all 39 fielded countries —
prepared as a technical proposal prototype, not an official Afrobarometer
product.

**Live demo:** https://fadl462.github.io/afrobarometer-insight-platform/

**Live locally:** open `index.html` in any modern browser, or serve the
repo root with any static file server (no build step, no server-side code —
everything runs client-side):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## What this is

The platform ships two tiers of data:

1. **Precomputed cross-country aggregates** (`data/country_aggregates.json`,
   `data/continental.json`) — small, fast-loading files covering every
   country on every indicator, so the Executive Briefing and Compare
   Countries views render instantly with no per-country fetch.
2. **Full respondent-level microdata, per country** (`data/countries/*.json`)
   — a columnar, integer-coded file for each of the 39 countries (~700–900KB
   raw, ~100KB gzipped), fetched on demand whenever you change the sidebar's
   **focus country** selector. This powers the deep-dive views (Indicator
   Explorer, Demographic Intelligence, Regional Intelligence, Policy Insight
   Centre, and within-country Ask-the-Data questions) with genuine
   respondent-level computation, not pre-baked charts.

Every statistic is traceable: single-country figures use `withinwt_hh`
(Afrobarometer's within-country weight); cross-country and continental
figures use `Combinwt_new_hh` (Afrobarometer's own multi-country weighting
factor, which gives each of the 39 countries equal say in the continental
average regardless of population — matching Afrobarometer's published
cross-country reporting convention).

### Modules
- **Executive Briefing** — continental headline KPIs, a rule-based insights
  feed, the top problems citizens name across all 39 countries, a country
  ranking on "direction of the country" (click a bar to make that country
  your focus country), and continental trust averages.
- **Africa Overview** — a real, geographically accurate choropleth map of
  the continent (`assets/africa-map.svg`, cropped from a CC BY-SA world map
  and cross-checked so all 39 surveyed countries' names match the dataset
  exactly). Pick any indicator and every surveyed country is shaded by its
  value on a continuous colour scale; unsurveyed countries are muted grey.
  Hover for the exact figure, click to make that country your focus.
- **Country Intelligence Centre** — deep profile of the focus country:
  sample composition, a chart benchmarking it against the continental
  average on headline indicators, and its numeric rank out of 39 countries
  on key measures.
- **Indicator Explorer** — theme → indicator → live distribution, regional
  comparison, urban/rural split, and demographic breakdown for the focus
  country, all filterable, with sortable data tables under every chart.
- **Demographic Intelligence** — build an arbitrary respondent segment
  within the focus country and compare it against that country's average.
- **Regional Intelligence** — every region within the focus country
  (auto-generated tile grid — region counts range from 4 to 47 across the
  39 countries, so layout isn't hand-placed) with click-to-filter detail.
- **Compare Countries** — genuinely real now: pick any indicator and see all
  39 countries ranked, with a dashed line marking the continental average,
  a sortable data table, and CSV export. Click a bar to make that country
  your focus.
- **Policy Insight Centre** — scans every indicator in the focus country
  against five demographic splits and reports gaps at or above a chosen
  threshold — fixed rules over weighted data, not generative text.
- **Ask the Data** — a floating assistant (every page) plus a dedicated Q&A
  Centre. The fixed-rule query engine (`js/qa-engine.js`) now understands:
  - **Country-vs-country comparisons** ("Compare Ghana and Kenya on trust in
    police") — answered directly from the precomputed aggregates, no fetch.
  - **Cross-country rankings** ("Which country has the highest support for
    democracy?") — ditto.
  - **Single-country lookups for countries other than your current focus**
    ("How do people in Nigeria feel about corruption in the police?") — with
    a one-click button to make that country your new focus for deeper
    within-country exploration.
  - Existing region/demographic/plain-lookup questions, scoped to whichever
    country is currently focused.
  - An auto-built FAQ (one entry per indicator, prompted with its real
    survey-question wording) plus 6 hand-authored cross-cutting questions.
- **Methodology & Downloads** — sampling details, citation, weighting
  conventions, and export of the indicator registry.

## Data & provenance

- Source: `R9_Merge_39ctry_20Nov23_final__release_Updated_4Jun25-3.sav` —
  Afrobarometer's official Round 9 merged dataset (39 countries, n=53,444),
  from https://www.afrobarometer.org/data/merged-data/.
- **106 indicators**, defined in `etl.py`. Every indicator's value labels and
  response-order are pulled *programmatically* from the `.sav` file's own
  embedded SPSS metadata (`pyreadstat`'s `variable_value_labels`) — not
  hand-transcribed — with an automated sanity check that flags any declared
  "favourable" label not actually present in that variable's real value set.
  Seven such mismatches were caught and fixed this way during development.
- Demographic fields reuse Afrobarometer's own pre-cleaned derived columns
  where available (`AGE_v1`, `EDUC_COND`, `RELIG_COND`, `LivedPoverty` /
  `LivedPoverty_CAT`) rather than re-deriving them.
- **Independently re-validated** against a second export of the same
  dataset (an .xlsx version): row count (53,444), column count (421), and
  the exact respondent count for all 39 countries were confirmed to match
  the `.sav`-derived pipeline with zero discrepancies.
- `etl.py` is the one-time transform from the raw `.sav` export into
  `data/{meta,indicators,continental,country_aggregates}.json` and
  `data/countries/*.json`. It is included for transparency/reproducibility
  and is not run in the browser. To reproduce: place the `.sav` file
  alongside `etl.py`, `pip install pyreadstat pandas numpy --break-system-packages`,
  and run it.

## Known limitations

- **"Ask the Data" is a fixed-rule query engine, not a language model.** It
  matches question text against the indicator registry's labels/question
  wording plus dictionaries of country/region/gender/age/education/
  lived-poverty terms (word-boundary matching, with simple suffix-stripping
  for plurals), then calls the same weighted-stats functions used
  everywhere else. It will say so rather than guess when nothing matches.
- **Only one country's microdata is loaded at a time.** This keeps initial
  load fast across 39 countries, but within-country region/demographic
  breakdowns for a country you haven't focused on aren't available until
  you switch to it (the assistant will offer a one-click button to do so).
- Some Round 9 items (e.g. detailed COVID-19 items, several country-specific
  extension questions) are not yet in the 106-indicator registry; the
  registry prioritizes breadth across themes over exhaustive coverage of
  every one of the ~420 columns in the source file.

## Citation

> Afrobarometer Data, Merged Round 9 (39 countries), 2021-2023, available at http://www.afrobarometer.org.

Afrobarometer data are protected by copyright; this repository is a
technical prototype prepared for a proposal to Afrobarometer and is not
redistributing the raw survey file — only the derived, respondent-level
JSON needed to power this specific demo.

## Stack

Vanilla HTML/CSS/JS, no build step. Chart.js and all web fonts are vendored
locally under `js/vendor/` and `fonts/` so the demo runs fully offline (no
CDN dependency at presentation time).
