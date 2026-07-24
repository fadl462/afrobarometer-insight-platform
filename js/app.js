/* =========================================================================
   Afrobarometer Insight Platform — application logic (39-country R9 build)
   Vanilla JS, no build step. Chart.js loaded locally in index.html.

   Data architecture:
   - meta.json / indicators.json / country_aggregates.json / continental.json
     load once at boot (all small, fast) and power continental views
     (Executive Briefing, Compare Countries) with NO per-country fetch.
   - data/countries/<slug>.json holds one country's full respondent-level
     microdata (columnar + integer-coded for size) and is fetched on demand
     whenever the sidebar's focus-country selector changes. It powers
     Indicator Explorer, Demographic Intelligence, Regional Intelligence,
     Policy Insight Centre, and Ask-the-Data's within-country questions.
   ========================================================================= */

const APP = {
  meta: null, indicators: null, aggregates: null, continental: null,
  records: null,           // decoded microdata for the current selected country
  countrySlug: null, countryName: null, countryPayload: null,
  charts: {}, demoFilters: {}, regionSelected: null,
  _countryDependentInited: false,
};

const DEFAULT_COUNTRY_SLUG = "ghana";

const DEMO_FIELDS = [
  { key: "gender", label: "Gender" },
  { key: "urbrur", label: "Setting" },
  { key: "age_group", label: "Age" },
  { key: "education", label: "Education" },
  { key: "religion", label: "Religion" },
  { key: "lpi_cat", label: "Lived poverty" },
];

const PALETTE = ["#F25528", "#233A5E", "#1E7A5F", "#A8790A", "#8A5DAB", "#C63F1A", "#5B6270"];

// ---------------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------------
async function boot() {
  const [meta, indicators, aggregates, continental] = await Promise.all([
    fetch("data/meta.json").then(r => r.json()),
    fetch("data/indicators.json").then(r => r.json()),
    fetch("data/country_aggregates.json").then(r => r.json()),
    fetch("data/continental.json").then(r => r.json()),
  ]);
  APP.meta = meta; APP.indicators = indicators; APP.aggregates = aggregates.by_indicator; APP.continental = continental;

  populateGlobalCountrySelect();
  initNav();
  initTheme();
  initGlobalSearch();
  renderExecutive();
  initCompareCountries();
  await initAfricaOverview();

  await loadCountry(DEFAULT_COUNTRY_SLUG);

  initIndicatorExplorer();
  initDemographicIntelligence();
  initRegionalIntelligence();
  initPolicyInsightCentre();
  renderCountry();
  renderMethodology();
  initAssistant();
  initQACentre();
  APP._countryDependentInited = true;
  switchView("executive"); // re-sync content/breadcrumb to the default view after all init-time renders ran
}

function populateGlobalCountrySelect() {
  const sel = document.getElementById("globalCountrySelect");
  const sorted = [...APP.meta.countries].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = sorted.map(c => `<option value="${c.slug}">${c.name} (n=${c.n})</option>`).join("");
  sel.value = DEFAULT_COUNTRY_SLUG;
  sel.addEventListener("change", () => refocusCountry(sel.value));
}

function getCurrentViewKey() {
  const activeBtn = document.querySelector(".nav-item.active");
  return activeBtn ? activeBtn.dataset.view : "executive";
}
/** Always use this (not setFocusCountry directly) from click handlers: awaits the country load,
    then re-syncs whichever view should be visible, so background renders can't win the breadcrumb race. */
async function refocusCountry(slug, targetView) {
  if (!slug) return;
  await setFocusCountry(slug);
  switchView(targetView || getCurrentViewKey());
}

async function setFocusCountry(slug) {
  document.getElementById("globalCountrySelect").value = slug;
  await loadCountry(slug);
  APP.regionSelected = null;
  renderCountry();
  populateIndicatorSelect();
  renderDemographic();
  renderRegional();
  renderPolicy();
  updateCountryTags();
  if (document.getElementById("africaIndicatorSelect").value) renderAfricaMap();
}

function updateCountryTags() {
  ["indCountryTag", "demoCountryTag", "regionCountryTag"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = APP.countryName;
  });
}

async function loadCountry(slug) {
  const statusEl = document.getElementById("countryLoadStatus");
  if (statusEl) statusEl.textContent = "Loading…";
  const payload = await fetch(`data/countries/${slug}.json`).then(r => r.json());
  APP.countrySlug = slug;
  APP.countryName = payload.country;
  APP.countryPayload = payload;
  APP.records = decodeCountryPayload(payload);
  if (statusEl) statusEl.textContent = `${payload.country} · n=${payload.n} · ${payload.regions.length} regions`;
  updateCountryTags();
}

/** Convert columnar, integer-coded country payload into the array-of-objects shape the stats engine expects. */
function decodeCountryPayload(payload) {
  const n = payload.n;
  const demo = payload.demo;
  const indVars = Object.keys(payload.ind);
  const orders = {};
  indVars.forEach(v => { orders[v] = (APP.indicators[v] && APP.indicators[v].order) || []; });
  const records = new Array(n);
  for (let i = 0; i < n; i++) {
    const ind = {};
    for (const v of indVars) {
      const c = payload.ind[v][i];
      ind[v] = (c === null || c === undefined) ? null : orders[v][c];
    }
    records[i] = {
      region: demo.region[i], urbrur: demo.urbrur[i], gender: demo.gender[i],
      age: demo.age[i], age_group: demo.age_group[i], education: demo.education[i],
      religion: demo.religion[i], lpi: demo.lpi[i], lpi_cat: demo.lpi_cat[i],
      weight: demo.weight_within[i], weight_combined: demo.weight_combined[i],
      ind,
    };
  }
  return records;
}

function countrySlugFor(name) {
  const c = APP.meta.countries.find(c => c.name === name);
  return c ? c.slug : null;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const VIEW_TITLES = {
  executive: "Executive Briefing", africa: "Africa Overview", country: "Country Intelligence Centre",
  indicator: "Indicator Explorer", demographic: "Demographic Intelligence",
  regional: "Regional Intelligence", compare: "Compare Countries",
  policy: "Evidence Intelligence", qa: "Ask the Data", methodology: "Methodology & Downloads",
};

function renderBreadcrumb(segments) {
  const bar = document.getElementById("breadcrumbBar");
  if (!bar) return;
  bar.innerHTML = segments.map((s, i) => {
    const isLast = i === segments.length - 1;
    return `<span class="bc-seg ${isLast ? "current" : ""}" data-bc-idx="${i}">${s.label}</span>` + (isLast ? "" : `<span class="bc-sep">›</span>`);
  }).join("");
  segments.forEach((s, i) => {
    if (s.onClick) bar.querySelector(`[data-bc-idx="${i}"]`).addEventListener("click", s.onClick);
  });
}
const bcAfrica = () => ({ label: "Africa", onClick: () => switchView("executive") });
const bcCountry = () => ({ label: APP.countryName, onClick: () => switchView("country") });

function getCurrentViewKey() {
  const activeSection = document.querySelector(".view.active");
  return activeSection ? activeSection.id.replace("view-", "") : "executive";
}

function switchView(viewKey) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === viewKey));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + viewKey).classList.add("active");
  document.getElementById("topbarTitle").textContent = VIEW_TITLES[viewKey];
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({ top: 0 });
  if (VIEW_RENDERERS[viewKey]) VIEW_RENDERERS[viewKey]();
}

const VIEW_RENDERERS = {
  executive: () => renderExecutive(),
  africa: () => renderAfricaMap(),
  country: () => renderCountry(),
  indicator: () => renderIndicatorExplorer(),
  demographic: () => renderDemographic(),
  regional: () => renderRegional(),
  compare: () => renderCompare(),
  policy: () => renderPolicy(),
  qa: () => renderBreadcrumb([bcAfrica(), { label: "Ask the Data" }]),
  methodology: () => renderBreadcrumb([bcAfrica(), { label: "Methodology & Downloads" }]),
};

function initNav() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
  const brand = document.getElementById("brandHome");
  brand.addEventListener("click", () => switchView("executive"));
  brand.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchView("executive"); } });
}

/** Jump to Indicator Explorer with a specific indicator (and optional filters) preselected, in the current selected country. */
function goToIndicatorView(varKey, filters) {
  const meta = APP.indicators[varKey];
  document.getElementById("themeSelect").value = meta.theme;
  populateIndicatorSelect();
  document.getElementById("indicatorSelect").value = varKey;
  document.querySelectorAll("#indFilterBar select").forEach(s => { s.value = (filters && filters[s.dataset.field]) || ""; });
  renderIndicatorExplorer();
  switchView("indicator");
}

function goToRegionalView(regionName, varKey) {
  if (varKey) document.getElementById("regionIndicatorSelect").value = varKey;
  APP.regionSelected = regionName;
  renderRegional();
  switchView("regional");
}

/** Jump to Compare Countries with a specific indicator preselected. */
function goToCompareView(varKey) {
  const meta = APP.indicators[varKey];
  document.getElementById("compareThemeSelect").value = meta.theme;
  populateCompareIndicatorSelect();
  document.getElementById("compareIndicatorSelect").value = varKey;
  renderCompare();
  switchView("compare");
}

function initTheme() {
  const saved = localStorage.getItem("ab-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeBtn(saved);
  document.getElementById("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ab-theme", next);
    updateThemeBtn(next);
    Object.values(APP.charts).forEach(c => c && c.update());
  });
}
function updateThemeBtn(mode) {
  document.getElementById("themeBtn").textContent = mode === "light" ? "Dark" : "Light";
}

// ---------------------------------------------------------------------------
// Core stats engine (operates on APP.records — the current selected country)
// ---------------------------------------------------------------------------
function applyFilters(records, filters) {
  const active = Object.entries(filters || {}).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (active.length === 0) return records;
  return records.filter(r => active.every(([field, val]) => {
    const rv = r[field];
    if (Array.isArray(val)) return val.includes(rv);
    return rv === val;
  }));
}

function weightedDistribution(records, varKey) {
  const meta = APP.indicators[varKey];
  const order = meta.order;
  const sums = {}; order.forEach(o => sums[o] = 0);
  let total = 0, n = 0;
  for (const r of records) {
    const v = r.ind[varKey];
    if (v === null || v === undefined || !(v in sums)) continue;
    sums[v] += r.weight; total += r.weight; n++;
  }
  const labels = order.map(o => (meta.short_labels && meta.short_labels[o]) || o);
  const pcts = order.map(o => total ? +(100 * sums[o] / total).toFixed(1) : 0);
  return { labels, pcts, n, total };
}

function weightedFavorable(records, varKey) {
  const meta = APP.indicators[varKey];
  if (!meta.positive) return { pct: null, n: 0 };
  const posSet = new Set(meta.positive);
  let num = 0, den = 0, n = 0;
  for (const r of records) {
    const v = r.ind[varKey];
    if (v === null || v === undefined) continue;
    den += r.weight; n++;
    if (posSet.has(v)) num += r.weight;
  }
  return { pct: den ? +(100 * num / den).toFixed(1) : null, n };
}

function groupFavorable(records, varKey, groupField) {
  const groups = {};
  for (const r of records) {
    const g = r[groupField];
    if (g === null || g === undefined) continue;
    (groups[g] = groups[g] || []).push(r);
  }
  const out = {};
  for (const [g, recs] of Object.entries(groups)) out[g] = { ...weightedFavorable(recs, varKey), size: recs.length };
  return out;
}

function fmtPct(v) { return v === null || v === undefined ? "—" : v.toFixed(1) + "%"; }

function renderSortableTable(containerId, columns, rows, initialSortKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let sortKey = initialSortKey || columns[0].key;
  let sortDir = -1;
  function draw() {
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    container.innerHTML = `<div class="table-wrap"><table class="datatable sortable"><thead><tr>${
      columns.map(c => `<th data-key="${c.key}" class="${c.key === sortKey ? 'sorted' : ''}">${c.label}<span class="sort-arrow">${c.key === sortKey ? (sortDir === 1 ? '▲' : '▼') : '▲▼'}</span></th>`).join("")
    }</tr></thead><tbody>${
      sorted.map(r => `<tr>${columns.map(c => `<td>${c.numeric ? (typeof r[c.key] === "number" ? (c.pct ? r[c.key].toFixed(1) + "%" : Math.round(r[c.key])) : r[c.key]) : r[c.key]}</td>`).join("")}</tr>`).join("")
    }</tbody></table></div>`;
    container.querySelectorAll("th").forEach(th => th.addEventListener("click", () => {
      const key = th.dataset.key;
      sortDir = (key === sortKey) ? -sortDir : -1;
      sortKey = key;
      draw();
    }));
  }
  draw();
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------
function ink() { return getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(); }
function inkSoft() { return getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim(); }
function line() { return getComputedStyle(document.documentElement).getPropertyValue("--line").trim(); }

function makeChart(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  if (APP.charts[canvasId]) APP.charts[canvasId].destroy();
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = inkSoft();
  const chart = new Chart(el.getContext("2d"), config);
  APP.charts[canvasId] = chart;
  return chart;
}

function barConfig(labels, data, opts = {}) {
  return {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: opts.colors || PALETTE[0], borderRadius: 6, maxBarThickness: opts.thick || 38 }] },
    options: {
      indexAxis: opts.horizontal ? "y" : "x",
      responsive: true, maintainAspectRatio: false,
      onClick: opts.onClick ? (evt, elements) => { if (elements.length) opts.onClick(elements[0].index); } : undefined,
      onHover: opts.onClick ? (evt, elements) => { evt.native.target.style.cursor = elements.length ? "pointer" : "default"; } : undefined,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.formattedValue}%` } },
        annotation: opts.refLine != null ? {
          annotations: { line1: { type: "line", [opts.horizontal ? "xMin" : "yMin"]: opts.refLine, [opts.horizontal ? "xMax" : "yMax"]: opts.refLine, borderColor: PALETTE[3], borderWidth: 2, borderDash: [6, 4] } }
        } : undefined,
      },
      scales: {
        x: { grid: { color: line() }, ticks: { callback: v => (opts.horizontal ? v + "%" : v) } },
        y: { grid: { color: opts.horizontal ? "transparent" : line() }, ticks: { callback: v => (opts.horizontal ? v : v + "%") } },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// EXECUTIVE BRIEFING (continental — no per-country fetch needed)
// ---------------------------------------------------------------------------
function renderExecutive() {
  const h = APP.continental.headline;
  const kpis = [
    { label: "Country's economic condition, positive", value: h.econ_condition_positive_pct, tag: h.econ_condition_positive_pct < 40 ? "bad" : "good", varKey: "Q4A" },
    { label: "Support for democracy", value: h.support_democracy_pct, tag: h.support_democracy_pct >= 60 ? "good" : "neutral", varKey: "Q23" },
    { label: "Satisfied with democracy", value: h.satisfied_democracy_pct, tag: h.satisfied_democracy_pct >= 50 ? "good" : "bad", varKey: "Q31" },
    { label: "Approve of President's performance", value: h.president_approval_pct, tag: h.president_approval_pct >= 50 ? "good" : "bad", varKey: "Q47A" },
    { label: "Corruption perceived to have worsened", value: h.corruption_worsened_pct, tag: "bad", varKey: "Q39A" },
    { label: "Household electricity grid access", value: h.electricity_access_pct, tag: "good", varKey: "Q92A" },
    { label: "Mobile internet access", value: h.internet_access_pct, tag: "good", varKey: "Q90G" },
    { label: "Trust in the Police", value: h.trust_police_pct, tag: h.trust_police_pct >= 50 ? "good" : "neutral", varKey: "Q37G" },
  ];
  document.getElementById("execKpis").innerHTML = kpis.map((k, i) => `
    <div class="kpi clickable" data-kpi-idx="${i}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${fmtPct(k.value)}</div>
      <span class="kpi-tag tag-${k.tag}">${k.tag === "good" ? "Favourable" : k.tag === "bad" ? "Watch" : "Mixed"}</span>
      <div class="click-hint">Explore across all 39 countries →</div>
    </div>`).join("");
  document.querySelectorAll("#execKpis .kpi").forEach((el, i) => {
    el.addEventListener("click", () => goToCompareView(kpis[i].varKey));
  });

  // Build the ticker only once per session: renderExecutive() re-runs every time the user
  // navigates back to this view, and resetting innerHTML each time would restart the CSS
  // marquee animation from frame zero. Guarding it keeps the animation running continuously
  // across in-app navigation. A sessionStorage-backed negative animation-delay additionally
  // keeps it looking continuous across a manual page refresh within the same browser session.
  if (!APP._tickerInit) {
    APP._tickerInit = true;
    const tickerItems = [
      `n=<b>${APP.continental.n_total}</b> respondents`, `<b>${APP.continental.n_countries}</b> countries`,
      `Support democracy: <b>${fmtPct(h.support_democracy_pct)}</b>`,
      `Trust president: <b>${fmtPct(h.trust_president_pct)}</b>`,
      `Trust police: <b>${fmtPct(h.trust_police_pct)}</b>`,
      `Corruption seen as worsening: <b>${fmtPct(h.corruption_worsened_pct)}</b>`,
      `Internet access: <b>${fmtPct(h.internet_access_pct)}</b>`,
    ];
    const tickerEl = document.getElementById("execTicker");
    tickerEl.innerHTML = tickerItems.concat(tickerItems).map(t => `<span>${t}</span>`).join("");

    const TICKER_DURATION_S = 32; // must match the CSS animation-duration on .ticker
    let startTs = parseInt(sessionStorage.getItem("ab_ticker_start") || "", 10);
    if (!startTs) {
      startTs = Date.now();
      sessionStorage.setItem("ab_ticker_start", String(startTs));
    }
    const elapsedS = ((Date.now() - startTs) / 1000) % TICKER_DURATION_S;
    tickerEl.style.animationDelay = `-${elapsedS}s`;
  }

  const insights = [];
  if (h.econ_condition_positive_pct < 30) insights.push(`Only ${fmtPct(h.econ_condition_positive_pct)} of respondents across the continent rate their country's economic condition positively — a strong signal of widespread economic strain.`);
  if (h.support_democracy_pct - h.satisfied_democracy_pct > 20) insights.push(`Support for democracy as a system (${fmtPct(h.support_democracy_pct)}) runs well ahead of satisfaction with how it is working in practice (${fmtPct(h.satisfied_democracy_pct)}) — a gap of ${(h.support_democracy_pct - h.satisfied_democracy_pct).toFixed(1)} points continent-wide, suggesting a performance problem rather than a legitimacy problem for democracy itself.`);
  if (h.corruption_worsened_pct > 55) insights.push(`A majority (${fmtPct(h.corruption_worsened_pct)}) of respondents across 39 countries believe corruption has increased over the past year.`);
  if (h.president_approval_pct < 55) insights.push(`Presidential approval averages ${fmtPct(h.president_approval_pct)} across the continent — worth cross-referencing against each country's economic sentiment in Compare Countries.`);
  if (h.electricity_access_pct - h.internet_access_pct > 5) insights.push(`Grid electricity access (${fmtPct(h.electricity_access_pct)}) outpaces mobile internet access (${fmtPct(h.internet_access_pct)}) continent-wide — a digital divide that persists even where basic infrastructure has reached most households.`);
  document.getElementById("execInsights").innerHTML = insights.map((t, i) => `<div class="finding"><span class="fn-badge">${i + 1}</span><span>${t}</span></div>`).join("");

  document.getElementById("execMip").innerHTML = APP.continental.top_problems.map(p => `
    <div class="rank-row clickable" data-mip="1">
      <div class="rank-name">${p.problem}</div>
      <div class="rank-track"><div class="rank-fill" style="width:${Math.min(100, p.pct * 6)}%"></div></div>
      <div class="rank-val">${p.pct}%</div>
    </div>`).join("");
  document.querySelectorAll('#execMip [data-mip]').forEach(el => el.addEventListener("click", () => goToIndicatorView("Q45PT1")));

  // Country ranking on "direction of the country" (top 7 + bottom 6 of 39)
  const q3 = APP.aggregates["Q3"];
  const entries = Object.entries(q3).filter(([k, v]) => k !== "__continental__" && v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
  const shown = entries.slice(0, 7).concat(entries.slice(-6));
  makeChart("execRegionChart", barConfig(shown.map(([k]) => k), shown.map(([, v]) => v.pct), {
    horizontal: true, colors: PALETTE[0], thick: 13,
    onClick: (i) => { const slug = countrySlugFor(shown[i][0]); refocusCountry(slug, "country"); },
  }));

  // Trust in institutions, continental average
  const trustVars = ["Q37A", "Q37B", "Q37C", "Q37G", "Q37H", "Q37I", "Q37J", "Q37K"];
  const trustLabels = trustVars.map(v => APP.indicators[v].label.replace("Trust: ", ""));
  const trustVals = trustVars.map(v => (APP.aggregates[v] && APP.aggregates[v].__continental__.pct));
  makeChart("execTrustChart", barConfig(trustLabels, trustVals, { horizontal: true, colors: PALETTE[1], thick: 16, onClick: (i) => goToIndicatorView(trustVars[i]) }));

  renderBreadcrumb([{ label: "Africa", current: true }]);
}

// ---------------------------------------------------------------------------
// AFRICA OVERVIEW (interactive choropleth, from precomputed aggregates)
// ---------------------------------------------------------------------------
function lerpColor(hexA, hexB, t) {
  const a = [1, 3, 5].map(i => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map(i => parseInt(hexB.slice(i, i + 2), 16));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}
function mapColorScale(t) {
  // three-stop scale: soft peach -> Afrobarometer orange -> deep brick, matching the legend gradient
  if (t < 0.5) return lerpColor("#FDE4DA", "#F25528", t / 0.5);
  return lerpColor("#F25528", "#8A2A0E", (t - 0.5) / 0.5);
}

async function initAfricaOverview() {
  const svgText = await fetch("assets/africa-map.svg").then(r => r.text());
  document.getElementById("africaMapWrap").innerHTML = svgText;
  document.querySelectorAll("#africaMapWrap title").forEach(t => t.remove());

  const themeSel = document.getElementById("africaThemeSelect");
  const themesWithAgg = [...new Set(Object.entries(APP.indicators).filter(([k]) => APP.aggregates[k]).map(([, v]) => v.theme))];
  themeSel.innerHTML = themesWithAgg.map(t => `<option value="${t}">${t}</option>`).join("");
  themeSel.value = "Democracy";
  themeSel.addEventListener("change", populateAfricaIndicatorSelect);
  document.getElementById("africaIndicatorSelect").addEventListener("change", renderAfricaMap);
  document.getElementById("btnAfricaExportPng").addEventListener("click", () => exportSvgAsPng("africaMapWrap", "africa_map.png"));

  const tooltip = document.createElement("div");
  tooltip.className = "map-tooltip";
  tooltip.id = "mapTooltip";
  document.body.appendChild(tooltip);

  populateAfricaIndicatorSelect();
}

function populateAfricaIndicatorSelect() {
  const theme = document.getElementById("africaThemeSelect").value;
  const sel = document.getElementById("africaIndicatorSelect");
  const opts = Object.entries(APP.indicators).filter(([k, v]) => v.theme === theme && APP.aggregates[k]);
  sel.innerHTML = opts.map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  if (opts.some(([k]) => k === "Q23") && theme === "Democracy") sel.value = "Q23";
  renderAfricaMap();
}

function renderAfricaMap() {
  const varKey = document.getElementById("africaIndicatorSelect").value;
  if (!varKey) return;
  const meta = APP.indicators[varKey];
  document.getElementById("africaQTitle").textContent = meta.label;
  document.getElementById("africaQWording").textContent = "“" + meta.question + "”";

  const agg = APP.aggregates[varKey];
  const entries = Object.entries(agg).filter(([k, v]) => k !== "__continental__" && v.pct !== null);
  const vals = entries.map(([, v]) => v.pct);
  const min = Math.min(...vals), max = Math.max(...vals);
  document.getElementById("mapLegendMin").textContent = min.toFixed(0) + "%";
  document.getElementById("mapLegendMax").textContent = max.toFixed(0) + "%";

  const byName = Object.fromEntries(entries);
  const tooltip = document.getElementById("mapTooltip");

  document.querySelectorAll("#africaMapWrap .country").forEach(path => {
    const name = path.dataset.name;
    path.classList.toggle("is-focus", name === APP.countryName);
    if (path.classList.contains("not-surveyed")) return;
    const v = byName[name];
    if (!v || v.pct === null) { path.style.fill = "var(--paper-deep)"; return; }
    const t = max > min ? (v.pct - min) / (max - min) : 0.5;
    path.style.fill = mapColorScale(t);

    path.onmousemove = (e) => {
      tooltip.style.display = "block";
      tooltip.style.left = (e.clientX + 14) + "px";
      tooltip.style.top = (e.clientY + 14) + "px";
      tooltip.innerHTML = `<b>${name}</b><br>${v.pct}% favourable (n=${v.n})`;
    };
    path.onmouseleave = () => { tooltip.style.display = "none"; };
    path.onclick = () => refocusCountry(countrySlugFor(name), "africa");
  });

  const ranked = entries.sort((a, b) => b[1].pct - a[1].pct);
  const rmax = Math.max(...ranked.map(([, v]) => v.pct), 1);
  document.getElementById("africaRankList").innerHTML = ranked.map(([k, v]) => `
    <div class="rank-row clickable" data-country-row="${k}">
      <div class="rank-name">${k}</div>
      <div class="rank-track"><div class="rank-fill" style="width:${(v.pct / rmax) * 100}%"></div></div>
      <div class="rank-val">${v.pct}%</div>
    </div>`).join("");
  document.querySelectorAll("#africaRankList [data-country-row]").forEach(el => {
    el.addEventListener("click", () => refocusCountry(countrySlugFor(el.dataset.countryRow), "africa"));
  });

  renderBreadcrumb([bcAfrica(), { label: meta.theme }, { label: meta.label }]);
}

// ---------------------------------------------------------------------------
// GLOBAL SEARCH (topbar) — finds indicators by keyword, jumps to Indicator Explorer
// ---------------------------------------------------------------------------
function initGlobalSearch() {
  const input = document.getElementById("globalSearchInput");
  const results = document.getElementById("globalSearchResults");

  function runSearch(q) {
    const query = q.trim().toLowerCase();
    if (!query) { results.classList.remove("open"); results.innerHTML = ""; return; }
    const tokens = query.split(/\s+/).filter(Boolean);

    const countryMatches = APP.meta.countries
      .filter(c => tokens.every(t => c.name.toLowerCase().includes(t)))
      .slice(0, 5);

    const indicatorMatches = Object.entries(APP.indicators).map(([key, meta]) => {
      const hay = (meta.theme + " " + meta.label + " " + meta.question).toLowerCase();
      const score = tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { key, meta, score };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);

    let html = "";
    if (countryMatches.length) {
      html += `<div class="gsr-group-label">Countries</div>` + countryMatches.map(c => `
        <div class="gsr-item" data-country-slug="${c.slug}"><div class="gsr-theme">Country</div><div class="gsr-label">${c.name} <span class="faint">(n=${c.n})</span></div></div>`).join("");
    }
    if (indicatorMatches.length) {
      html += `<div class="gsr-group-label">Indicators &amp; questions</div>` + indicatorMatches.map(r => `
        <div class="gsr-item" data-key="${r.key}"><div class="gsr-theme">${r.meta.theme}</div><div class="gsr-label">${r.meta.label}</div></div>`).join("");
    }
    results.innerHTML = html || `<div class="gsr-empty">No matches for “${q}”.</div>`;
    results.classList.add("open");

    results.querySelectorAll(".gsr-item[data-key]").forEach(el => {
      el.addEventListener("click", () => { goToIndicatorView(el.dataset.key); input.value = ""; results.classList.remove("open"); });
    });
    results.querySelectorAll(".gsr-item[data-country-slug]").forEach(el => {
      el.addEventListener("click", () => { refocusCountry(el.dataset.countrySlug, "country"); input.value = ""; results.classList.remove("open"); });
    });
  }

  input.addEventListener("input", () => runSearch(input.value));
  input.addEventListener("focus", () => { if (input.value.trim()) results.classList.add("open"); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".global-search-wrap")) results.classList.remove("open");
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.blur(); results.classList.remove("open"); }
    if (e.key === "Enter") {
      const first = results.querySelector(".gsr-item");
      if (first) first.click();
    }
  });
}

// ---------------------------------------------------------------------------
// COUNTRY INTELLIGENCE CENTRE (selected country vs continental average)
// ---------------------------------------------------------------------------
function renderCountry() {
  document.getElementById("countryViewTitle").textContent = `${APP.countryName} — Round 9 country profile`;
  const payload = APP.countryPayload;
  const cards = [
    { label: "Sample size", value: payload.n },
    { label: "Regions surveyed", value: payload.regions.length },
    { label: "Weighting", value: "withinwt_hh", small: true },
    { label: "Dataset", value: "Afrobarometer R9 Merge", small: true },
  ];
  document.getElementById("countryStatCards").innerHTML = cards.map(c => `
    <div class="kpi"><div class="kpi-label">${c.label}</div>
    <div class="${c.small ? 'kpi-sub' : 'kpi-value'}" style="${c.small ? 'font-size:15px;font-weight:600;color:var(--ink);margin-top:4px;' : ''}">${c.value}</div></div>`).join("");

  const genders = groupCount(APP.records, "gender");
  const settings = groupCount(APP.records, "urbrur");
  makeChart("countryGenderChart", {
    type: "doughnut",
    data: { labels: [...Object.keys(genders), ...Object.keys(settings)], datasets: [{ data: [...Object.values(genders), ...Object.values(settings)], backgroundColor: PALETTE }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
  });

  const ages = groupCount(APP.records, "age_group");
  const ageOrder = ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"];
  makeChart("countryAgeChart", barConfig(ageOrder, ageOrder.map(a => ages[a] || 0), { colors: PALETTE[2] }));

  // vs continental average on headline indicators
  const headlineVars = ["Q4A", "Q23", "Q31", "Q47A", "Q37G", "Q92A", "Q90G"];
  const countryVals = headlineVars.map(v => weightedFavorable(APP.records, v).pct);
  const contVals = headlineVars.map(v => APP.aggregates[v] ? APP.aggregates[v].__continental__.pct : null);
  makeChart("countryVsContinentChart", {
    type: "bar",
    data: {
      labels: headlineVars.map(v => APP.indicators[v].label),
      datasets: [
        { label: APP.countryName, data: countryVals, backgroundColor: PALETTE[0], borderRadius: 6 },
        { label: "Continental average", data: contVals, backgroundColor: PALETTE[6], borderRadius: 6 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { x: { min: 0, max: 100, ticks: { callback: v => v + "%" }, grid: { color: line() } }, y: { grid: { display: false } } },
    },
  });

  const econRank = rankCountry("Q4A"), demRank = rankCountry("Q23");
  document.getElementById("countryNarrative").innerHTML = `
    <div class="insight"><b>${APP.countryName}</b> respondents rate their economy positively at <b>${fmtPct(weightedFavorable(APP.records, "Q4A").pct)}</b>, ranking <b>#${econRank.rank} of ${econRank.total}</b> countries surveyed (continental average: ${fmtPct(APP.aggregates["Q4A"].__continental__.pct)}).</div>
    <div class="insight">Support for democracy stands at <b>${fmtPct(weightedFavorable(APP.records, "Q23").pct)}</b>, ranking <b>#${demRank.rank} of ${demRank.total}</b> (continental average: ${fmtPct(APP.aggregates["Q23"].__continental__.pct)}).</div>`;

  document.getElementById("countryMethodBox").innerHTML = `
    <dl class="dl-grid">
      <dt>Universe</dt><dd>Citizens of ${APP.countryName}, 18 years and older</dd>
      <dt>Design</dt><dd>Nationally representative, random, clustered, stratified, multi-stage area probability sample</dd>
      <dt>Sample</dt><dd>n = ${payload.n} across ${payload.regions.length} regions</dd>
      <dt>Weighting</dt><dd>withinwt_hh — corrects for individual selection probability, region, urban/rural distribution, household &amp; EA size</dd>
      <dt>Dataset</dt><dd>Afrobarometer Round 9 Merged Data (39 countries)</dd>
    </dl>`;

  renderBreadcrumb([bcAfrica(), { label: APP.countryName, current: true }]);
}

function rankCountry(varKey) {
  const entries = Object.entries(APP.aggregates[varKey]).filter(([k, v]) => k !== "__continental__" && v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
  const idx = entries.findIndex(([k]) => k === APP.countryName);
  return { rank: idx + 1, total: entries.length };
}

function groupCount(records, field) {
  const c = {};
  for (const r of records) { const v = r[field]; if (v == null) continue; c[v] = (c[v] || 0) + 1; }
  return c;
}

// ---------------------------------------------------------------------------
// INDICATOR EXPLORER
// ---------------------------------------------------------------------------
function themeList() {
  const seen = [];
  Object.values(APP.indicators).forEach(i => { if (!seen.includes(i.theme)) seen.push(i.theme); });
  return seen;
}

function initIndicatorExplorer() {
  const themeSel = document.getElementById("themeSelect");
  themeSel.innerHTML = themeList().map(t => `<option value="${t}">${t}</option>`).join("");
  themeSel.addEventListener("change", () => { populateIndicatorSelect(); });
  document.getElementById("indicatorSelect").addEventListener("change", renderIndicatorExplorer);

  const filterBar = document.getElementById("indFilterBar");
  filterBar.innerHTML = filterSelectHTML("ind", ["region", "urbrur", "gender", "age_group", "education"]);
  filterBar.querySelectorAll("select").forEach(s => s.addEventListener("change", renderIndicatorExplorer));

  populateIndicatorSelect();
  updateCountryTags();

  document.getElementById("btnExportPng").addEventListener("click", () => exportChartPng("indDistChart", "distribution"));
  document.getElementById("btnExportCsv").addEventListener("click", exportIndicatorCsv);
  document.getElementById("btnCite").addEventListener("click", () => {
    navigator.clipboard?.writeText(currentCitation()).then(() => flashBtn("btnCite", "Copied!"));
  });
}

function filterSelectHTML(prefix, fields) {
  const labelMap = { region: "Region", urbrur: "Setting", gender: "Gender", age_group: "Age", education: "Education", religion: "Religion", lpi_cat: "Lived poverty" };
  return fields.map(f => {
    const values = [...new Set(APP.records.map(r => r[f]).filter(Boolean))];
    if (f === "age_group") values.sort((a, b) => ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"].indexOf(a) - ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"].indexOf(b));
    else values.sort();
    return `<div class="select-field"><label>${labelMap[f]}</label>
      <select id="${prefix}_${f}" data-field="${f}"><option value="">All</option>${values.map(v => `<option value="${v}">${v}</option>`).join("")}</select></div>`;
  }).join("");
}

function populateIndicatorSelect() {
  const theme = document.getElementById("themeSelect").value || themeList()[0];
  const sel = document.getElementById("indicatorSelect");
  const prevVal = sel.value;
  const opts = Object.entries(APP.indicators).filter(([, v]) => v.theme === theme);
  sel.innerHTML = opts.map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  if (opts.some(([k]) => k === prevVal)) sel.value = prevVal;
  // refresh demographic filter option lists too, since the selected country may have changed
  const filterBar = document.getElementById("indFilterBar");
  if (filterBar) {
    filterBar.innerHTML = filterSelectHTML("ind", ["region", "urbrur", "gender", "age_group", "education"]);
    filterBar.querySelectorAll("select").forEach(s => s.addEventListener("change", renderIndicatorExplorer));
  }
  renderIndicatorExplorer();
}

function currentIndFilters() {
  const f = {};
  document.querySelectorAll("#indFilterBar select").forEach(s => { if (s.value) f[s.dataset.field] = s.value; });
  return f;
}

function renderIndicatorExplorer() {
  const varKey = document.getElementById("indicatorSelect").value;
  if (!varKey) return;
  const meta = APP.indicators[varKey];
  const filters = currentIndFilters();
  const filtered = applyFilters(APP.records, filters);

  document.getElementById("indThemeBadge").textContent = meta.theme;
  document.getElementById("indQTitle").textContent = meta.label;
  document.getElementById("indQWording").textContent = "Survey question: “" + meta.question + "”";

  const dist = weightedDistribution(filtered, varKey);
  document.getElementById("indDistN").textContent = `n = ${dist.n}${Object.keys(filters).length ? " (filtered)" : ""}`;
  makeChart("indDistChart", barConfig(dist.labels, dist.pcts, { horizontal: true, colors: PALETTE[0] }));
  renderSortableTable("indDistTable",
    [{ key: "response", label: "Response" }, { key: "pct", label: "%", numeric: true, pct: true }],
    dist.labels.map((l, i) => ({ response: l, pct: dist.pcts[i] })), "pct");

  const regionMetricEl = document.getElementById("indRegionMetric");
  if (meta.positive) {
    regionMetricEl.textContent = "% favourable, by region";
    const rg = groupFavorable(filtered, varKey, "region");
    const entries = Object.entries(rg).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
    makeChart("indRegionChart", barConfig(entries.map(([k]) => k), entries.map(([, v]) => v.pct), {
      horizontal: true, colors: PALETTE[1], thick: 12,
      onClick: (i) => { document.getElementById("ind_region").value = entries[i][0]; renderIndicatorExplorer(); },
    }));
    renderSortableTable("indRegionTable",
      [{ key: "region", label: "Region" }, { key: "pct", label: "% favourable", numeric: true, pct: true }, { key: "n", label: "n", numeric: true }],
      entries.map(([k, v]) => ({ region: k, pct: v.pct, n: v.size })), "pct");
  } else {
    regionMetricEl.textContent = "most common response, by region";
    const regions = [...new Set(filtered.map(r => r.region).filter(Boolean))].sort();
    const modal = regions.map(reg => {
      const sub = filtered.filter(r => r.region === reg);
      const d = weightedDistribution(sub, varKey);
      const maxI = d.pcts.indexOf(Math.max(...d.pcts));
      return d.pcts[maxI];
    });
    makeChart("indRegionChart", barConfig(regions, modal, {
      horizontal: true, colors: PALETTE[1], thick: 12,
      onClick: (i) => { document.getElementById("ind_region").value = regions[i]; renderIndicatorExplorer(); },
    }));
    renderSortableTable("indRegionTable",
      [{ key: "region", label: "Region" }, { key: "pct", label: "Top response %", numeric: true, pct: true }],
      regions.map((reg, i) => ({ region: reg, pct: modal[i] })), "pct");
  }

  if (meta.positive) {
    const ug = groupFavorable(filtered, varKey, "urbrur");
    makeChart("indUrbanChart", barConfig(Object.keys(ug), Object.values(ug).map(v => v.pct), { colors: [PALETTE[0], PALETTE[1], PALETTE[2]] }));
  } else {
    const cats = [...new Set(filtered.map(r => r.urbrur).filter(Boolean))].map(u => {
      const sub = filtered.filter(r => r.urbrur === u);
      const d = weightedDistribution(sub, varKey);
      return Math.max(...d.pcts);
    });
    makeChart("indUrbanChart", barConfig([...new Set(filtered.map(r => r.urbrur).filter(Boolean))], cats, { colors: [PALETTE[0], PALETTE[1], PALETTE[2]] }));
  }

  const demoLabels = [], demoVals = [], demoColors = [];
  if (meta.positive) {
    const genders = groupFavorable(filtered, varKey, "gender");
    Object.entries(genders).forEach(([k, v]) => { demoLabels.push("Gender: " + k); demoVals.push(v.pct); demoColors.push(PALETTE[0]); });
    const ages = groupFavorable(filtered, varKey, "age_group");
    ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"].forEach(a => { if (ages[a]) { demoLabels.push("Age: " + a); demoVals.push(ages[a].pct); demoColors.push(PALETTE[1]); } });
    const edus = groupFavorable(filtered, varKey, "education");
    ["No formal education", "Primary", "Secondary", "Post-secondary"].forEach(ed => { if (edus[ed]) { demoLabels.push("Edu: " + ed); demoVals.push(edus[ed].pct); demoColors.push(PALETTE[2]); } });
    makeChart("indDemoChart", barConfig(demoLabels, demoVals, { horizontal: true, colors: demoColors, thick: 14 }));
  } else {
    if (APP.charts["indDemoChart"]) APP.charts["indDemoChart"].destroy();
    makeChart("indDemoChart", { type: "bar", data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: false } } } });
  }

  document.getElementById("indMetaBox").innerHTML = `
    <dl class="dl-grid">
      <dt>Variable</dt><dd class="mono">${varKey}</dd>
      <dt>Theme</dt><dd>${meta.theme}</dd>
      <dt>Country</dt><dd>${APP.countryName}</dd>
      <dt>Source</dt><dd>Afrobarometer Round 9 Merged Data</dd>
      <dt>Base</dt><dd>n = ${dist.n} valid responses${Object.keys(filters).length ? " within current filter" : ""}</dd>
      <dt>Weighting</dt><dd>withinwt_hh</dd>
    </dl>`;

  renderBreadcrumb([bcAfrica(), bcCountry(), { label: meta.theme }, { label: meta.label, current: true }]);
}

function currentCitation() { return APP.meta.citation; }
function flashBtn(id, text) {
  const b = document.getElementById(id); const orig = b.textContent;
  b.textContent = text; setTimeout(() => b.textContent = orig, 1400);
}
function exportChartPng(canvasId, name) {
  const chart = APP.charts[canvasId]; if (!chart) return;
  const a = document.createElement("a"); a.href = chart.toBase64Image(); a.download = `${name}.png`; a.click();
}
function exportSvgAsPng(containerId, filename) {
  const wrap = document.getElementById(containerId);
  const svgEl = wrap.querySelector("svg");
  if (!svgEl) return;
  const rect = wrap.getBoundingClientRect();
  const width = Math.round(rect.width) || 640, height = Math.round(rect.height) || 480;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("width", width); clone.setAttribute("height", height);
  const svgData = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale; canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    });
  };
  img.src = url;
}
function exportIndicatorCsv() {
  const varKey = document.getElementById("indicatorSelect").value;
  const filtered = applyFilters(APP.records, currentIndFilters());
  const dist = weightedDistribution(filtered, varKey);
  let csv = "response,percent\n";
  dist.labels.forEach((l, i) => csv += `"${l}",${dist.pcts[i]}\n`);
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${varKey}_${APP.countrySlug}_distribution.csv`; a.click();
}

// ---------------------------------------------------------------------------
// DEMOGRAPHIC INTELLIGENCE
// ---------------------------------------------------------------------------
function initDemographicIntelligence() {
  const themeSel = document.getElementById("demoIndicatorSelect");
  themeSel.innerHTML = Object.entries(APP.indicators).map(([k, v]) => `<option value="${k}">${v.theme} — ${v.label}</option>`).join("");
  themeSel.addEventListener("change", renderDemographic);
  buildDemoFilterBar();
  updateCountryTags();
  renderDemographic();
}

function buildDemoFilterBar() {
  const bar = document.getElementById("demoFilterBar");
  bar.innerHTML = `<div class="grid cols-2">` + DEMO_FIELDS.map(f => {
    const values = [...new Set(APP.records.map(r => r[f.key]).filter(Boolean))].sort();
    return `<div class="select-field"><label>${f.label}</label>
      <select data-field="${f.key}" class="demoFilterSelect"><option value="">All</option>${values.map(v => `<option value="${v}">${v}</option>`).join("")}</select></div>`;
  }).join("") + `</div>`;
  bar.querySelectorAll(".demoFilterSelect").forEach(s => s.addEventListener("change", renderDemographic));
}

function renderDemographic() {
  buildDemoFilterBar(); // refresh option lists in case selected country changed
  const filters = {};
  document.querySelectorAll(".demoFilterSelect").forEach(s => { if (s.value) filters[s.dataset.field] = s.value; });
  const segment = applyFilters(APP.records, filters);
  document.getElementById("demoSegN").textContent = segment.length;

  const varKey = document.getElementById("demoIndicatorSelect").value;
  const meta = APP.indicators[varKey];
  document.getElementById("demoQWording").textContent = "“" + meta.question + "”";

  const dist = weightedDistribution(segment, varKey);
  makeChart("demoDistChart", barConfig(dist.labels, dist.pcts, { horizontal: true, colors: PALETTE[2] }));

  if (meta.positive) {
    const natl = weightedFavorable(APP.records, varKey);
    const seg = weightedFavorable(segment, varKey);
    makeChart("demoCompareChart", {
      type: "bar",
      data: { labels: [`${APP.countryName} average`, "Selected segment"], datasets: [{ data: [natl.pct, seg.pct], backgroundColor: [PALETTE[6], PALETTE[0]], borderRadius: 8, maxBarThickness: 70 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { callback: v => v + "%" }, grid: { color: line() } }, y: { grid: { display: false } } } },
    });
  } else {
    if (APP.charts["demoCompareChart"]) APP.charts["demoCompareChart"].destroy();
    makeChart("demoCompareChart", { type: "bar", data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: false } } } });
  }

  renderBreadcrumb([bcAfrica(), bcCountry(), { label: "Demographic Intelligence" }, { label: meta.label, current: true }]);
}

// ---------------------------------------------------------------------------
// REGIONAL INTELLIGENCE (regions of the current selected country; layout is
// auto-generated, not hand-placed, since region sets differ per country)
// ---------------------------------------------------------------------------
function initRegionalIntelligence() {
  const sel = document.getElementById("regionIndicatorSelect");
  sel.innerHTML = Object.entries(APP.indicators).filter(([, v]) => v.positive).map(([k, v]) => `<option value="${k}">${v.theme} — ${v.label}</option>`).join("");
  sel.value = "Q4A";
  sel.addEventListener("change", renderRegional);
  document.getElementById("btnClearRegion").addEventListener("click", () => { APP.regionSelected = null; renderRegional(); });
  updateCountryTags();
  renderRegional();
}

function renderRegional() {
  const varKey = document.getElementById("regionIndicatorSelect").value;
  const byRegion = groupFavorable(APP.records, varKey, "region");
  const regionsSorted = [...new Set(APP.records.map(r => r.region).filter(Boolean))].sort();

  const grid = document.getElementById("regionGrid");
  grid.innerHTML = regionsSorted.map(reg => {
    const v = byRegion[reg];
    const pct = v && v.pct !== null ? v.pct : null;
    const selected = APP.regionSelected === reg ? "selected" : "";
    return `<div class="region-tile ${selected}" data-region="${reg}">
      <div class="rt-name">${reg}</div>
      <div class="rt-val">${pct !== null ? pct + "%" : "—"}</div>
      <div class="rt-n">n=${v ? v.size : 0}</div>
    </div>`;
  }).join("");
  grid.querySelectorAll(".region-tile[data-region]").forEach(tile => {
    tile.addEventListener("click", () => {
      const r = tile.dataset.region;
      APP.regionSelected = APP.regionSelected === r ? null : r;
      renderRegional();
    });
  });

  const entries = Object.entries(byRegion).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
  const max = Math.max(...entries.map(([, v]) => v.pct), 1);
  document.getElementById("regionRankList").innerHTML = entries.map(([k, v]) => `
    <div class="rank-row clickable" data-region-row="${k}">
      <div class="rank-name">${k}</div>
      <div class="rank-track"><div class="rank-fill" style="width:${(v.pct / max) * 100}%"></div></div>
      <div class="rank-val">${v.pct}%</div>
    </div>`).join("");
  document.querySelectorAll('#regionRankList [data-region-row]').forEach(el => {
    el.addEventListener("click", () => {
      APP.regionSelected = APP.regionSelected === el.dataset.regionRow ? null : el.dataset.regionRow;
      renderRegional();
    });
  });

  const detailCard = document.getElementById("regionDetailCard");
  if (APP.regionSelected) {
    detailCard.style.display = "";
    document.getElementById("regionDetailTitle").textContent = APP.regionSelected + " — detail";
    const regionRecords = APP.records.filter(r => r.region === APP.regionSelected);
    const statVars = ["Q4A", "Q47A", "Q37A", "Q90G"];
    document.getElementById("regionDetailStats").innerHTML = statVars.map(v => {
      const f = weightedFavorable(regionRecords, v);
      return `<div class="kpi"><div class="kpi-label">${APP.indicators[v].label}</div><div class="kpi-value">${fmtPct(f.pct)}</div></div>`;
    }).join("");
  } else {
    detailCard.style.display = "none";
  }

  const regSegs = [bcAfrica(), bcCountry(), { label: "Regional Intelligence", current: !APP.regionSelected }];
  if (APP.regionSelected) regSegs.push({ label: APP.regionSelected, current: true });
  renderBreadcrumb(regSegs);
}

// ---------------------------------------------------------------------------
// COMPARE COUNTRIES (all 39, from precomputed aggregates — no microdata fetch)
// ---------------------------------------------------------------------------
function initCompareCountries() {
  const themeSel = document.getElementById("compareThemeSelect");
  const themesWithAgg = [...new Set(Object.entries(APP.indicators).filter(([k]) => APP.aggregates[k]).map(([, v]) => v.theme))];
  themeSel.innerHTML = themesWithAgg.map(t => `<option value="${t}">${t}</option>`).join("");
  themeSel.addEventListener("change", populateCompareIndicatorSelect);
  document.getElementById("compareIndicatorSelect").addEventListener("change", renderCompare);
  document.getElementById("btnCompareExportCsv").addEventListener("click", exportCompareCsv);
  document.getElementById("btnCompareExportPng").addEventListener("click", () => exportChartPng("compareRankChart", "country_comparison"));
  populateCompareIndicatorSelect();
}

function populateCompareIndicatorSelect() {
  const theme = document.getElementById("compareThemeSelect").value;
  const sel = document.getElementById("compareIndicatorSelect");
  const prevVal = sel.value;
  const opts = Object.entries(APP.indicators).filter(([k, v]) => v.theme === theme && APP.aggregates[k]);
  sel.innerHTML = opts.map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  if (opts.some(([k]) => k === prevVal)) sel.value = prevVal;
  renderCompare();
}

function renderCompare() {
  const varKey = document.getElementById("compareIndicatorSelect").value;
  if (!varKey) return;
  const meta = APP.indicators[varKey];
  document.getElementById("compareThemeBadge").textContent = meta.theme;
  document.getElementById("compareQTitle").textContent = meta.label;
  document.getElementById("compareQWording").textContent = "Survey question: “" + meta.question + "”";

  const data = APP.aggregates[varKey];
  const cont = data.__continental__;
  document.getElementById("compareContinentalVal").textContent = fmtPct(cont.pct);

  const entries = Object.entries(data).filter(([k, v]) => k !== "__continental__" && v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
  makeChart("compareRankChart", barConfig(entries.map(([k]) => k), entries.map(([, v]) => v.pct), {
    horizontal: true, colors: PALETTE[0], thick: 14, refLine: cont.pct,
    onClick: (i) => { const slug = countrySlugFor(entries[i][0]); refocusCountry(slug, "compare"); },
  }));

  renderSortableTable("compareTable",
    [{ key: "country", label: "Country" }, { key: "pct", label: "% favourable", numeric: true, pct: true }, { key: "n", label: "n", numeric: true }],
    entries.map(([k, v]) => ({ country: k, pct: v.pct, n: v.n })), "pct");

  renderBreadcrumb([bcAfrica(), { label: meta.theme }, { label: meta.label, current: true }]);
}

function exportCompareCsv() {
  const varKey = document.getElementById("compareIndicatorSelect").value;
  const data = APP.aggregates[varKey];
  const entries = Object.entries(data).filter(([k, v]) => k !== "__continental__" && v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
  let csv = "country,percent,n\n";
  entries.forEach(([k, v]) => csv += `"${k}",${v.pct},${v.n}\n`);
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${varKey}_country_comparison.csv`; a.click();
}

// ---------------------------------------------------------------------------
// POLICY INSIGHT CENTRE (rule-based, scoped to the selected country)
// ---------------------------------------------------------------------------
const POLICY_SPLIT_FIELDS = [
  { key: "gender", labelFn: () => `between men and women` },
  { key: "urbrur", labelFn: (a, b) => `between ${a.toLowerCase()} and ${b.toLowerCase()} residents` },
  { key: "education", labelFn: (a, b) => `by education level (${a} vs. ${b})` },
  { key: "lpi_cat", labelFn: (a, b) => `by lived-poverty band (${a} vs. ${b})` },
  { key: "age_group", labelFn: (a, b) => `by age (${a} vs. ${b})` },
];

function initPolicyInsightCentre() {
  const sel = document.getElementById("policyThemeSelect");
  sel.innerHTML = `<option value="">All themes</option>` + themeList().map(t => `<option value="${t}">${t}</option>`).join("");
  sel.addEventListener("change", renderPolicy);
  document.getElementById("policyGapSelect").addEventListener("change", renderPolicy);
  renderPolicy();
}

function renderPolicy() {
  const themeFilter = document.getElementById("policyThemeSelect").value;
  const minGap = parseFloat(document.getElementById("policyGapSelect").value);
  const findings = [];

  Object.entries(APP.indicators).forEach(([varKey, meta]) => {
    if (!meta.positive) return;
    if (themeFilter && meta.theme !== themeFilter) return;

    POLICY_SPLIT_FIELDS.forEach(split => {
      const groups = groupFavorable(APP.records, varKey, split.key);
      const entries = Object.entries(groups).filter(([, v]) => v.pct !== null && v.size >= 30);
      if (entries.length < 2) return;
      entries.sort((a, b) => b[1].pct - a[1].pct);
      const [topK, topV] = entries[0];
      const [botK, botV] = entries[entries.length - 1];
      const gap = topV.pct - botV.pct;
      if (gap >= minGap) {
        findings.push({
          gap, varKey, theme: meta.theme, label: meta.label,
          text: `<b>${meta.label}</b>: ${topK} report ${topV.pct}% favourable, versus ${botV.pct}% among ${botK} — a ${gap.toFixed(1)}-point gap ${split.labelFn(topK, botK)}.`,
        });
      }
    });
  });

  findings.sort((a, b) => b.gap - a.gap);
  const top = findings.slice(0, 25);
  document.getElementById("policyFindings").innerHTML = top.length
    ? top.map((f, i) => `<div class="finding clickable" data-policy-var="${f.varKey}"><span class="fn-badge">${i + 1}</span><span>${f.text}</span></div>`).join("")
    : `<div class="finding"><span>No gaps at or above this threshold were found for the selected theme in ${APP.countryName}. Try lowering the minimum gap.</span></div>`;
  document.querySelectorAll('#policyFindings [data-policy-var]').forEach(el => {
    el.addEventListener("click", () => goToIndicatorView(el.dataset.policyVar));
  });

  renderBreadcrumb([bcAfrica(), bcCountry(), { label: "Evidence Intelligence", current: true }]);
}

// ---------------------------------------------------------------------------
// METHODOLOGY
// ---------------------------------------------------------------------------
function renderMethodology() {
  const m = APP.meta;
  document.getElementById("methodSamplingBox").innerHTML = `
    <dl class="dl-grid">
      <dt>Dataset</dt><dd>${m.dataset}</dd>
      <dt>Round</dt><dd>${m.round}</dd>
      <dt>Countries</dt><dd>${m.countries.length}</dd>
      <dt>Total sample</dt><dd>${m.n_total}</dd>
      <dt>Source file</dt><dd class="mono" style="font-size:11px;">${m.source_file}</dd>
      <dt>Codebook</dt><dd class="mono" style="font-size:11px;">${m.codebook_source}</dd>
    </dl>`;
  document.getElementById("methodCitation").textContent = m.citation;
  document.getElementById("btnCopyCitation").addEventListener("click", () => {
    navigator.clipboard?.writeText(m.citation).then(() => flashBtn("btnCopyCitation", "Copied!"));
  });
  document.getElementById("dlIndicators").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(APP.indicators, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "indicator_registry.json"; a.click();
  });
  document.getElementById("dlCodebookNote").addEventListener("click", () => {
    const txt = `Afrobarometer Insight Platform — codebook reference\n\nSource: ${m.codebook_source}\nCitation: ${m.citation}\n\nAll ${Object.keys(APP.indicators).length} indicators in this platform were matched against the official Afrobarometer Round 9 merge codebook, with value labels and response scales pulled programmatically from the dataset's own embedded SPSS metadata (not hand-transcribed) to avoid mismatch. See indicator_registry.json for full question wording and response scales.`;
    const blob = new Blob([txt], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "codebook_reference.txt"; a.click();
  });
}

// ---------------------------------------------------------------------------
// ASK THE DATA — assistant + Q&A Centre (shared fixed-rule query engine)
// ---------------------------------------------------------------------------
let qaChartCounter = 0;

function qaCtx() {
  return {
    records: APP.records, indicators: APP.indicators,
    regionNames: [...new Set(APP.records.map(r => r.region).filter(Boolean))],
    countryNames: APP.meta.countries.map(c => c.name),
    aggregates: APP.aggregates, focusCountry: APP.countryName,
    applyFilters, weightedDistribution, weightedFavorable, groupFavorable,
  };
}

function renderAnswerNode(ans) {
  const uid = "qac_" + (qaChartCounter++);
  const wrap = document.createElement("div");
  if (!ans.ok) {
    wrap.innerHTML = `<div>${ans.message}</div>` + (ans.suggestions ? `<div class="qa-actions">${ans.suggestions.map(s => `<span class="pill">${s}</span>`).join("")}</div>` : "");
    return wrap;
  }
  wrap.innerHTML = `
    <div>${ans.narrative}</div>
    ${ans.question ? `<div class="qa-note">Survey question: "${ans.question}"</div>` : ""}
    ${ans.chart ? `<div class="qa-chart-box"><canvas id="${uid}"></canvas></div>` : ""}
    <div class="qa-actions">
      ${ans.varKey ? `<button class="btn" data-open-var="${ans.varKey}">Open in Indicator Explorer →</button>` : ""}
      ${ans.switchCountry ? `<button class="btn" data-switch-country="${ans.switchCountry}">Switch selected country to ${ans.switchCountry} →</button>` : ""}
    </div>
  `;
  if (ans.chart) {
    setTimeout(() => {
      const el = wrap.querySelector(`#${uid}`);
      if (el) makeChart(uid, barConfig(ans.chart.labels, ans.chart.data, { horizontal: ans.chart.horizontal, colors: PALETTE[0], refLine: ans.chart.refLine }));
    }, 0);
  }
  const btn = wrap.querySelector("[data-open-var]");
  if (btn) btn.addEventListener("click", () => { goToIndicatorView(btn.dataset.openVar, ans.filters); document.getElementById("assistPanel").classList.remove("open"); document.getElementById("assistFab").classList.remove("hide"); });
  const swBtn = wrap.querySelector("[data-switch-country]");
  if (swBtn) swBtn.addEventListener("click", () => refocusCountry(countrySlugFor(swBtn.dataset.switchCountry), "country"));
  return wrap;
}

const ASSIST_SUGGESTIONS = [
  "Which country has the highest support for democracy?",
  "Compare Ghana and Kenya on trust in police",
  "Which region trusts the police least?",
  "Do young people use the internet more?",
  "What's the biggest problem facing the country?",
];

function initAssistant() {
  const fab = document.getElementById("assistFab"), panel = document.getElementById("assistPanel");
  fab.addEventListener("click", () => { panel.classList.add("open"); fab.classList.add("hide"); });
  document.getElementById("assistClose").addEventListener("click", () => { panel.classList.remove("open"); fab.classList.remove("hide"); });
  document.getElementById("assistMaximize").addEventListener("click", (e) => {
    panel.classList.toggle("maximized");
    e.currentTarget.textContent = panel.classList.contains("maximized") ? "⤡" : "⤢";
    e.currentTarget.setAttribute("aria-label", panel.classList.contains("maximized") ? "Collapse" : "Expand");
  });

  document.getElementById("assistSuggestRow").innerHTML = ASSIST_SUGGESTIONS.slice(0, 3).map(s => `<span class="pill">${s}</span>`).join("");
  document.querySelectorAll("#assistSuggestRow .pill").forEach(p => p.addEventListener("click", () => runAssistantQuery(p.textContent)));

  const body = document.getElementById("assistBody");
  const greet = document.createElement("div");
  greet.className = "assist-msg bot";
  greet.innerHTML = `Ask me anything about the Afrobarometer Round 9 survey — a topic, a country, a region within ${APP.countryName} (your currently selected country), or a demographic group. I run fixed calculations over the real microdata and precomputed country aggregates, so every answer is traceable.`;
  body.appendChild(greet);

  document.getElementById("assistSend").addEventListener("click", sendFromInput);
  document.getElementById("assistInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendFromInput(); });
  function sendFromInput() {
    const input = document.getElementById("assistInput");
    if (!input.value.trim()) return;
    runAssistantQuery(input.value.trim());
    input.value = "";
  }
}

function runAssistantQuery(text) {
  const body = document.getElementById("assistBody");
  const userMsg = document.createElement("div");
  userMsg.className = "assist-msg user";
  userMsg.textContent = text;
  body.appendChild(userMsg);

  const ans = qaAnswer(text, qaCtx());
  const botMsg = document.createElement("div");
  botMsg.className = "assist-msg bot";
  botMsg.appendChild(renderAnswerNode(ans));
  body.appendChild(botMsg);
  body.scrollTop = body.scrollHeight;
}

function initQACentre() {
  document.getElementById("qaSuggestChips").innerHTML = ASSIST_SUGGESTIONS.map(s => `<span class="pill">${s}</span>`).join("");
  document.querySelectorAll("#qaSuggestChips .pill").forEach(p => p.addEventListener("click", () => runQACentreQuery(p.textContent)));
  document.getElementById("qaSearchBtn").addEventListener("click", () => {
    const input = document.getElementById("qaSearchInput");
    if (input.value.trim()) runQACentreQuery(input.value.trim());
  });
  document.getElementById("qaSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.value.trim()) runQACentreQuery(e.target.value.trim());
  });

  const specials = qaSpecialQuestions(qaCtx());
  document.getElementById("qaSpecialList").innerHTML = specials.map((s, i) => `
    <details class="qa-item qa-special"><summary>${s.q}</summary><div class="qa-answer" id="qaSpecial_${i}"></div></details>
  `).join("");
  specials.forEach((s, i) => {
    document.querySelectorAll("details.qa-special")[i].addEventListener("toggle", function () {
      const container = document.getElementById(`qaSpecial_${i}`);
      if (container.dataset.rendered) return;
      container.dataset.rendered = "1";
      container.appendChild(renderAnswerNode({ ok: true, narrative: s.narrative, chart: s.chart }));
    });
  });

  const themeBlocks = document.getElementById("qaThemeBlocks");
  themeBlocks.innerHTML = themeList().map(theme => {
    const items = Object.entries(APP.indicators).filter(([, v]) => v.theme === theme);
    return `<div class="qa-theme-block">
      <div class="qa-theme-title">${theme}</div>
      ${items.map(([key, meta]) => `<details class="qa-item" data-var="${key}"><summary>${meta.question}</summary><div class="qa-answer" id="qaFaq_${key}"></div></details>`).join("")}
    </div>`;
  }).join("");
  themeBlocks.querySelectorAll("details.qa-item").forEach(d => {
    d.addEventListener("toggle", function () {
      const key = d.dataset.var;
      const container = document.getElementById(`qaFaq_${key}`);
      if (container.dataset.rendered) return;
      container.dataset.rendered = "1";
      const ans = qaAnswer(APP.indicators[key].question, qaCtx());
      container.appendChild(renderAnswerNode(ans));
    });
  });
}

function runQACentreQuery(text) {
  const container = document.getElementById("qaFreeformAnswers");
  const block = document.createElement("div");
  block.className = "card mt-16";
  block.innerHTML = `<h3>“${text}”</h3>`;
  const ans = qaAnswer(text, qaCtx());
  block.appendChild(renderAnswerNode(ans));
  container.prepend(block);
}

// ---------------------------------------------------------------------------
boot();
