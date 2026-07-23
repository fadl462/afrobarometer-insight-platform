/* =========================================================================
   Afrobarometer Insight Platform — application logic
   Vanilla JS, no build step. Chart.js loaded via CDN in index.html.
   All statistics are computed client-side from respondent-level microdata
   (site/data/records.json), weighted by withinwt_hh.
   ========================================================================= */

const APP = {
  meta: null, indicators: null, records: null, exec: null,
  charts: {},              // holds live Chart.js instances keyed by canvas id, so we can destroy/redraw
  demoFilters: {},         // Demographic Intelligence: multi-select filter state
  regionSelected: null,
};

const DEMO_FIELDS = [
  { key: "gender", label: "Gender" },
  { key: "urbrur", label: "Setting" },
  { key: "age_group", label: "Age" },
  { key: "education", label: "Education" },
  { key: "religion", label: "Religion" },
  { key: "employment", label: "Employment" },
  { key: "lpi_cat", label: "Lived poverty" },
];

const PALETTE = ["#F25528", "#233A5E", "#1E7A5F", "#A8790A", "#8A5DAB", "#C63F1A", "#5B6270"];

// ---------------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------------
async function boot() {
  const [meta, indicators, records, exec] = await Promise.all([
    fetch("data/meta.json").then(r => r.json()),
    fetch("data/indicators.json").then(r => r.json()),
    fetch("data/records.json").then(r => r.json()),
    fetch("data/executive.json").then(r => r.json()),
  ]);
  APP.meta = meta; APP.indicators = indicators; APP.records = records; APP.exec = exec;

  document.getElementById("sidebarMeta").innerHTML =
    `${meta.country} · Round ${meta.round} · n=${meta.sample_size}<br>Fieldwork: ${meta.fieldwork_dates}`;

  initNav();
  initTheme();
  renderExecutive();
  renderCountry();
  initIndicatorExplorer();
  initDemographicIntelligence();
  initRegionalIntelligence();
  initPolicyInsightCentre();
  renderMethodology();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function initNav() {
  const titles = {
    executive: "Executive Briefing", country: "Country Intelligence Centre",
    indicator: "Indicator Explorer", demographic: "Demographic Intelligence",
    regional: "Regional Intelligence", compare: "Compare Countries",
    policy: "Policy Insight Centre", methodology: "Methodology & Downloads",
  };
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      document.getElementById("view-" + btn.dataset.view).classList.add("active");
      document.getElementById("topbarTitle").textContent = titles[btn.dataset.view];
      document.getElementById("sidebar").classList.remove("open");
    });
  });
  document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
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
    // redraw charts so colors track theme (Chart.js caches canvas gradients otherwise)
    Object.values(APP.charts).forEach(c => c && c.update());
  });
}
function updateThemeBtn(mode) {
  document.getElementById("themeBtn").textContent = mode === "light" ? "Dark" : "Light";
}

// ---------------------------------------------------------------------------
// Core stats engine
// ---------------------------------------------------------------------------

/** filters: { field: value | array-of-values }. null/undefined/'' entries are ignored. */
function applyFilters(records, filters) {
  const active = Object.entries(filters || {}).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (active.length === 0) return records;
  return records.filter(r => active.every(([field, val]) => {
    const rv = r[field];
    if (Array.isArray(val)) return val.includes(rv);
    return rv === val;
  }));
}

/** Weighted distribution over an indicator's declared value order. Returns {labels, pcts, n, counts} */
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

/** Weighted % of respondents whose response is in the indicator's "positive" set. Returns {pct, n} or {pct:null,n:0} */
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

/** Group `records` by `groupField`, compute weightedFavorable of varKey within each group. */
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

// ---------------------------------------------------------------------------
// Chart helper
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
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.formattedValue}%` } } },
      scales: {
        x: { grid: { color: line() }, ticks: { callback: v => (opts.horizontal ? v + "%" : v) } },
        y: { grid: { color: opts.horizontal ? "transparent" : line() }, ticks: { callback: v => (opts.horizontal ? v : v + "%") } },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// EXECUTIVE BRIEFING
// ---------------------------------------------------------------------------
function renderExecutive() {
  const e = APP.exec;
  const kpis = [
    { label: "Country's economic condition, positive", value: e.econ_condition_positive_pct, tag: e.econ_condition_positive_pct < 40 ? "bad" : "good" },
    { label: "Support for democracy", value: e.support_democracy_pct, tag: e.support_democracy_pct >= 60 ? "good" : "neutral" },
    { label: "Satisfied with democracy", value: e.satisfied_democracy_pct, tag: e.satisfied_democracy_pct >= 50 ? "good" : "bad" },
    { label: "Approve of President's performance", value: e.president_approval_pct, tag: e.president_approval_pct >= 50 ? "good" : "bad" },
    { label: "Corruption perceived to have worsened", value: e.corruption_worsened_pct, tag: "bad" },
    { label: "Household electricity grid access", value: e.electricity_access_pct, tag: "good" },
    { label: "Mobile internet access", value: e.internet_access_pct, tag: "good" },
    { label: "High lived poverty", value: e.high_lived_poverty_pct, tag: "bad" },
  ];
  document.getElementById("execKpis").innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${fmtPct(k.value)}</div>
      <span class="kpi-tag tag-${k.tag}">${k.tag === "good" ? "Favourable" : k.tag === "bad" ? "Watch" : "Mixed"}</span>
    </div>`).join("");

  const tickerItems = [
    `n=<b>${e.sample_size}</b> respondents`, `<b>${e.regions_covered}</b> regions covered`,
    `Right direction: <b>${fmtPct(e.right_direction_pct)}</b>`,
    `Trust president: <b>${fmtPct(e.trust_president_pct)}</b>`,
    `Trust police: <b>${fmtPct(e.trust_police_pct)}</b>`,
    `Presidency seen as corrupt: <b>${fmtPct(e.corruption_pres_office_high_pct)}</b>`,
    `Avg. lived poverty index: <b>${e.avg_lived_poverty_index}</b> / 4`,
  ];
  document.getElementById("execTicker").innerHTML = tickerItems.concat(tickerItems).map(t => `<span>${t}</span>`).join("");

  // Rule-based executive insights (plain sentences derived directly from KPIs — no generative text)
  const insights = [];
  if (e.right_direction_pct < 25) insights.push(`Only ${fmtPct(e.right_direction_pct)} of citizens say the country is going in the right direction — a strong signal of public dissatisfaction with the current trajectory.`);
  if (e.support_democracy_pct - e.satisfied_democracy_pct > 15) insights.push(`Support for democracy as a system (${fmtPct(e.support_democracy_pct)}) runs well ahead of satisfaction with how it is working in practice (${fmtPct(e.satisfied_democracy_pct)}) — a gap of ${(e.support_democracy_pct - e.satisfied_democracy_pct).toFixed(1)} points that suggests a performance problem, not a legitimacy problem.`);
  if (e.corruption_worsened_pct > 60) insights.push(`${fmtPct(e.corruption_worsened_pct)} of citizens believe corruption has increased over the past year, and Corruption ranks among the top named problems facing the country.`);
  if (e.president_approval_pct < 40) insights.push(`Presidential approval sits at ${fmtPct(e.president_approval_pct)}, below the halfway mark — worth tracking against economic sentiment, which is also weak.`);
  if (e.electricity_access_pct - e.internet_access_pct > 20) insights.push(`Grid electricity access (${fmtPct(e.electricity_access_pct)}) is well ahead of mobile internet access (${fmtPct(e.internet_access_pct)}) — a meaningful digital divide remains even where basic infrastructure has reached most households.`);
  document.getElementById("execInsights").innerHTML = insights.map((t, i) => `<div class="finding"><span class="fn-badge">${i + 1}</span><span>${t}</span></div>`).join("");

  document.getElementById("execMip").innerHTML = e.top_problems.map(p => `
    <div class="rank-row">
      <div class="rank-name">${p.problem}</div>
      <div class="rank-track"><div class="rank-fill" style="width:${Math.min(100, p.pct * 4)}%"></div></div>
      <div class="rank-val">${p.pct}%</div>
    </div>`).join("");

  // Direction of country by region
  const regionGroups = groupFavorable(APP.records, "Q3", "region");
  const rEntries = Object.entries(regionGroups).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
  makeChart("execRegionChart", barConfig(rEntries.map(([k]) => k), rEntries.map(([, v]) => v.pct), { horizontal: true, colors: PALETTE[0], thick: 14 }));

  // Trust in institutions, national
  const trustVars = ["Q37A", "Q37B", "Q37C", "Q37G", "Q37I", "Q37K", "Q37M"];
  const trustLabels = trustVars.map(v => APP.indicators[v].label.replace("Trust: ", ""));
  const trustVals = trustVars.map(v => weightedFavorable(APP.records, v).pct);
  makeChart("execTrustChart", barConfig(trustLabels, trustVals, { horizontal: true, colors: PALETTE[1], thick: 14 }));
}

// ---------------------------------------------------------------------------
// COUNTRY INTELLIGENCE CENTRE
// ---------------------------------------------------------------------------
function renderCountry() {
  const m = APP.meta, e = APP.exec;
  const cards = [
    { label: "Sample size", value: m.sample_size },
    { label: "Regions surveyed", value: e.regions_covered },
    { label: "Fieldwork window", value: m.fieldwork_dates, small: true },
    { label: "Margin of error", value: m.margin_of_error, small: true },
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

  document.getElementById("countryNarrative").innerHTML = `
    <div class="insight">Ghanaians surveyed in August 2024 describe an economy under real strain: only <b>${fmtPct(e.econ_condition_positive_pct)}</b> rate the country's economic condition positively, and <b>unemployment</b>, <b>infrastructure</b>, and the <b>cost of living</b> dominate the list of problems citizens most want government to address.</div>
    <div class="insight">Commitment to democracy as an ideal remains high (<b>${fmtPct(e.support_democracy_pct)}</b> prefer it to any other system), even as satisfaction with its day-to-day performance is far more mixed (<b>${fmtPct(e.satisfied_democracy_pct)}</b>) — a pattern consistent with frustration directed at incumbents and institutions rather than at the democratic system itself.</div>
    <div class="insight">Corruption perceptions are a standout concern: a majority believe it has worsened over the past year, and the Presidency, Parliament, and the Police are all seen as substantially compromised by a majority of respondents.</div>`;

  document.getElementById("countryMethodBox").innerHTML = `
    <dl>
      <dt>Universe</dt><dd>Citizens of Ghana, 18 years and older</dd>
      <dt>Design</dt><dd>Nationally representative, random, clustered, stratified, multi-stage area probability sample</dd>
      <dt>Fieldwork partner</dt><dd>${m.fieldwork_partner}</dd>
      <dt>Languages</dt><dd>${m.languages.join(", ")}</dd>
      <dt>Weighting</dt><dd>withinwt_hh — corrects for individual selection probability, region, urban/rural distribution, household &amp; EA size</dd>
    </dl>`.replace("<dl>", "<dl style='display:grid;grid-template-columns:150px 1fr;gap:8px 12px;'>");
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

  ["ind_region", "ind_urbrur", "ind_gender", "ind_age_group", "ind_education"].forEach(() => {});
  const filterBar = document.getElementById("indFilterBar");
  filterBar.innerHTML = filterSelectHTML("ind", ["region", "urbrur", "gender", "age_group", "education"]);
  filterBar.querySelectorAll("select").forEach(s => s.addEventListener("change", renderIndicatorExplorer));

  populateIndicatorSelect();

  document.getElementById("btnExportPng").addEventListener("click", () => exportChartPng("indDistChart", "distribution"));
  document.getElementById("btnExportCsv").addEventListener("click", exportIndicatorCsv);
  document.getElementById("btnCite").addEventListener("click", () => {
    navigator.clipboard?.writeText(currentCitation()).then(() => flashBtn("btnCite", "Copied!"));
  });
}

function filterSelectHTML(prefix, fields) {
  const labelMap = { region: "Region", urbrur: "Setting", gender: "Gender", age_group: "Age", education: "Education", religion: "Religion", employment: "Employment", lpi_cat: "Lived poverty" };
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
  const opts = Object.entries(APP.indicators).filter(([, v]) => v.theme === theme);
  sel.innerHTML = opts.map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
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

  // Regional comparison (only meaningful if favourable set defined)
  const regionMetricEl = document.getElementById("indRegionMetric");
  if (meta.positive) {
    regionMetricEl.textContent = "% favourable, by region";
    const rg = groupFavorable(filtered, varKey, "region");
    const entries = Object.entries(rg).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
    makeChart("indRegionChart", barConfig(entries.map(([k]) => k), entries.map(([, v]) => v.pct), { horizontal: true, colors: PALETTE[1], thick: 12 }));
  } else {
    regionMetricEl.textContent = "most common response, by region";
    const regions = [...new Set(filtered.map(r => r.region).filter(Boolean))].sort();
    const modal = regions.map(reg => {
      const sub = filtered.filter(r => r.region === reg);
      const d = weightedDistribution(sub, varKey);
      const maxI = d.pcts.indexOf(Math.max(...d.pcts));
      return d.pcts[maxI];
    });
    makeChart("indRegionChart", barConfig(regions, modal, { horizontal: true, colors: PALETTE[1], thick: 12 }));
  }

  // Urban / rural
  if (meta.positive) {
    const ug = groupFavorable(filtered, varKey, "urbrur");
    makeChart("indUrbanChart", barConfig(Object.keys(ug), Object.values(ug).map(v => v.pct), { colors: [PALETTE[0], PALETTE[1]] }));
  } else {
    const cats = ["Urban", "Rural"].map(u => {
      const sub = filtered.filter(r => r.urbrur === u);
      const d = weightedDistribution(sub, varKey);
      return Math.max(...d.pcts);
    });
    makeChart("indUrbanChart", barConfig(["Urban", "Rural"], cats, { colors: [PALETTE[0], PALETTE[1]] }));
  }

  // Demographic comparison — gender / age / education, all as favourable% if available, else n/a
  const demoLabels = [], demoVals = [], demoColors = [];
  if (meta.positive) {
    const genders = groupFavorable(filtered, varKey, "gender");
    Object.entries(genders).forEach(([k, v]) => { demoLabels.push("Gender: " + k); demoVals.push(v.pct); demoColors.push(PALETTE[0]); });
    const ages = groupFavorable(filtered, varKey, "age_group");
    ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"].forEach(a => { if (ages[a]) { demoLabels.push("Age: " + a); demoVals.push(ages[a].pct); demoColors.push(PALETTE[1]); } });
    const edus = groupFavorable(filtered, varKey, "education");
    ["No formal schooling", "Primary", "Secondary", "Post-secondary (non-university)", "University"].forEach(ed => { if (edus[ed]) { demoLabels.push("Edu: " + ed); demoVals.push(edus[ed].pct); demoColors.push(PALETTE[2]); } });
    makeChart("indDemoChart", barConfig(demoLabels, demoVals, { horizontal: true, colors: demoColors, thick: 14 }));
  } else {
    document.getElementById("indDemoChart").getContext("2d");
    if (APP.charts["indDemoChart"]) APP.charts["indDemoChart"].destroy();
    makeChart("indDemoChart", { type: "bar", data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: false } } } });
  }

  document.getElementById("indMetaBox").innerHTML = `
    <dl style="display:grid;grid-template-columns:150px 1fr;gap:8px 12px;">
      <dt>Variable</dt><dd class="mono">${varKey}</dd>
      <dt>Theme</dt><dd>${meta.theme}</dd>
      <dt>Source</dt><dd>Afrobarometer Round 10, Ghana (2024)</dd>
      <dt>Base</dt><dd>n = ${dist.n} valid responses${Object.keys(filters).length ? " within current filter" : " (national)"}</dd>
      <dt>Weighting</dt><dd>withinwt_hh</dd>
    </dl>`;
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
function exportIndicatorCsv() {
  const varKey = document.getElementById("indicatorSelect").value;
  const filtered = applyFilters(APP.records, currentIndFilters());
  const dist = weightedDistribution(filtered, varKey);
  let csv = "response,percent\n";
  dist.labels.forEach((l, i) => csv += `"${l}",${dist.pcts[i]}\n`);
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${varKey}_distribution.csv`; a.click();
}

// ---------------------------------------------------------------------------
// DEMOGRAPHIC INTELLIGENCE
// ---------------------------------------------------------------------------
function initDemographicIntelligence() {
  const bar = document.getElementById("demoFilterBar");
  bar.innerHTML = `<div class="grid cols-2">` + DEMO_FIELDS.map(f => {
    const values = [...new Set(APP.records.map(r => r[f.key]).filter(Boolean))].sort();
    return `<div class="select-field"><label>${f.label}</label>
      <select data-field="${f.key}" class="demoFilterSelect"><option value="">All</option>${values.map(v => `<option value="${v}">${v}</option>`).join("")}</select></div>`;
  }).join("") + `</div>`;
  bar.querySelectorAll(".demoFilterSelect").forEach(s => s.addEventListener("change", renderDemographic));

  const themeSel = document.getElementById("demoIndicatorSelect");
  themeSel.innerHTML = Object.entries(APP.indicators).map(([k, v]) => `<option value="${k}">${v.theme} — ${v.label}</option>`).join("");
  themeSel.addEventListener("change", renderDemographic);
  renderDemographic();
}

function renderDemographic() {
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
      data: { labels: ["National average", "Selected segment"], datasets: [{ data: [natl.pct, seg.pct], backgroundColor: [PALETTE[6], PALETTE[0]], borderRadius: 8, maxBarThickness: 70 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { callback: v => v + "%" }, grid: { color: line() } }, y: { grid: { display: false } } } },
    });
  } else {
    if (APP.charts["demoCompareChart"]) APP.charts["demoCompareChart"].destroy();
    makeChart("demoCompareChart", { type: "bar", data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: false } } } });
  }
}

// ---------------------------------------------------------------------------
// REGIONAL INTELLIGENCE
// ---------------------------------------------------------------------------
// Rough NW->SE schematic grid position for each region (4 columns), north at top.
const REGION_GRID_ORDER = [
  "Upper West", "Upper East", "North East", "Savannah",
  "Northern", "Bono East", "Bono", "Oti",
  "Ahafo", "Ashanti", "Volta", "Western North",
  "Western", "Central", "Eastern", "Greater Accra",
];

function initRegionalIntelligence() {
  const sel = document.getElementById("regionIndicatorSelect");
  sel.innerHTML = Object.entries(APP.indicators).filter(([, v]) => v.positive).map(([k, v]) => `<option value="${k}">${v.theme} — ${v.label}</option>`).join("");
  sel.value = "Q4A";
  sel.addEventListener("change", renderRegional);
  document.getElementById("btnClearRegion").addEventListener("click", () => { APP.regionSelected = null; renderRegional(); });
  renderRegional();
}

function renderRegional() {
  const varKey = document.getElementById("regionIndicatorSelect").value;
  const meta = APP.indicators[varKey];
  const byRegion = groupFavorable(APP.records, varKey, "region");

  const grid = document.getElementById("regionGrid");
  grid.innerHTML = REGION_GRID_ORDER.map(reg => {
    if (!reg) return `<div></div>`;
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
    <div class="rank-row">
      <div class="rank-name">${k}</div>
      <div class="rank-track"><div class="rank-fill" style="width:${(v.pct / max) * 100}%"></div></div>
      <div class="rank-val">${v.pct}%</div>
    </div>`).join("");

  const detailCard = document.getElementById("regionDetailCard");
  if (APP.regionSelected) {
    detailCard.style.display = "";
    document.getElementById("regionDetailTitle").textContent = APP.regionSelected + " — detail";
    const regionRecords = APP.records.filter(r => r.region === APP.regionSelected);
    const statVars = ["Q4A", "Q48A", "Q37A", "Q90H"];
    document.getElementById("regionDetailStats").innerHTML = statVars.map(v => {
      const f = weightedFavorable(regionRecords, v);
      return `<div class="kpi"><div class="kpi-label">${APP.indicators[v].label}</div><div class="kpi-value">${fmtPct(f.pct)}</div></div>`;
    }).join("");
  } else {
    detailCard.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// POLICY INSIGHT CENTRE (rule-based)
// ---------------------------------------------------------------------------
const POLICY_SPLIT_FIELDS = [
  { key: "gender", labelFn: (a, b) => `between men and women` },
  { key: "urbrur", labelFn: (a, b) => `between urban and rural residents` },
  { key: "education", labelFn: (a, b) => `by education level (${a} vs. ${b})` },
  { key: "lpi_cat", labelFn: (a, b) => `by lived-poverty band (${a} vs. ${b})` },
  { key: "age_group", labelFn: (a, b) => `by age (${a} vs. ${b})` },
];

function initPolicyInsightCentre() {
  const sel = document.getElementById("policyThemeSelect");
  themeList().forEach(t => sel.insertAdjacentHTML("beforeend", `<option value="${t}">${t}</option>`));
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
      const entries = Object.entries(groups).filter(([, v]) => v.pct !== null && v.size >= 40);
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
    ? top.map((f, i) => `<div class="finding"><span class="fn-badge">${i + 1}</span><span>${f.text}</span></div>`).join("")
    : `<div class="finding"><span>No gaps at or above this threshold were found for the selected theme. Try lowering the minimum gap.</span></div>`;
}

// ---------------------------------------------------------------------------
// METHODOLOGY
// ---------------------------------------------------------------------------
function renderMethodology() {
  const m = APP.meta;
  document.getElementById("methodSamplingBox").innerHTML = `
    <dl style="display:grid;grid-template-columns:150px 1fr;gap:8px 12px;">
      <dt>Country</dt><dd>${m.country}</dd>
      <dt>Round</dt><dd>${m.round} (${m.year})</dd>
      <dt>Sample size</dt><dd>${m.sample_size}</dd>
      <dt>Fieldwork</dt><dd>${m.fieldwork_dates}</dd>
      <dt>Partner</dt><dd>${m.fieldwork_partner}</dd>
      <dt>Margin of error</dt><dd>${m.margin_of_error}</dd>
      <dt>Languages</dt><dd>${m.languages.join(", ")}</dd>
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
    const txt = `Afrobarometer Insight Platform — codebook reference\n\nSource: ${m.codebook_source}\nCitation: ${m.citation}\n\nAll ${Object.keys(APP.indicators).length} indicators in this platform were transcribed and cross-checked against the official Afrobarometer Round 10 Ghana codebook. See indicator_registry.json for full question wording and response scales.`;
    const blob = new Blob([txt], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "codebook_reference.txt"; a.click();
  });
}

// ---------------------------------------------------------------------------
boot();
