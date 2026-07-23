/* =========================================================================
   QA-ENGINE — a fixed-rule "ask the data" query layer.
   Not a generative model: it fuzzy-matches a typed question against the
   indicator registry and a small dictionary of demographic terms, then runs
   the exact same weighted-stats functions the rest of the platform uses.
   Every answer is reproducible and traceable to a specific calculation.
   Depends on globals set by app.js at boot: APP.records, APP.indicators,
   and the stats helpers (applyFilters, weightedDistribution, weightedFavorable,
   groupFavorable) which are attached to window for reuse here.
   ========================================================================= */

const QA = {};

QA.STOPWORDS = new Set(["the","a","an","is","are","of","in","on","to","for","and","or","do","does","what","which",
  "how","who","most","many","much","people","citizens","ghanaians","think","about","than","compared","with","by",
  "than","among","between","that","this","their","them","they","have","has","did","not","no","yes","tell","me","show"]);

QA.THEME_SYNONYMS = {
  "Direction & Economy": ["economy","economic","jobs","unemployment","prices","cost","living","inflation","gdp"],
  "Lived Poverty": ["poverty","poor","hunger","food","water","fuel","cash","income","hardship"],
  "Democracy": ["democracy","democratic","freedom","elections","term","limits"],
  "Elections": ["election","vote","voting","ballot","voters"],
  "Governance": ["government","governance","president","parliament","mp","performance","judges","courts","media"],
  "Corruption": ["corrupt","corruption","bribe","bribery"],
  "Trust": ["trust","confidence","reliable"],
  "Gender": ["women","woman","men","man","gender","girls","female","male"],
  "Youth": ["youth","young","jobs","employment"],
  "Public Services": ["hospital","clinic","health","medical","id","document","services"],
  "Infrastructure": ["electricity","power","grid","water","infrastructure"],
  "Digital Access": ["internet","mobile","phone","online","digital"],
  "Media": ["radio","news","media","social"],
  "Climate": ["climate","environment","drought","flood","weather"],
  "Security": ["safe","unsafe","crime","police","security"],
  "Migration": ["emigrate","emigration","migrate","leave","abroad"],
  "International": ["china","america","us","influence","foreign"],
};

QA.GENDER_TERMS = { women:"Woman", woman:"Woman", female:"Woman", females:"Woman", men:"Man", man:"Man", male:"Man", males:"Man" };
QA.SETTING_TERMS = { urban:"Urban", cities:"Urban", city:"Urban", rural:"Rural", countryside:"Rural", villages:"Rural", village:"Rural" };
QA.AGE_TERMS = { youth:"18-25", "young people":"18-25", young:"18-25", "youngest":"18-25", elderly:"66+", seniors:"66+", "older people":"56-65", "old people":"66+" };
QA.EDU_TERMS = { university:"University", tertiary:"University", educated:"University", uneducated:"No formal schooling", "no education":"No formal schooling", "no schooling":"No formal schooling", "no formal schooling":"No formal schooling", "primary school":"Primary", secondary:"Secondary" };
QA.LPI_TERMS = { "lived poverty":"High lived poverty", "poorest":"High lived poverty", "wealthiest":"No lived poverty", "richest":"No lived poverty" };

function qaTokens(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t && !QA.STOPWORDS.has(t));
}

/** Build once: per-indicator corpus split into label (high-weight) vs full (low-weight) text. */
function qaBuildCorpus(indicators) {
  const corpus = {};
  for (const [key, meta] of Object.entries(indicators)) {
    const syn = QA.THEME_SYNONYMS[meta.theme] || [];
    corpus[key] = {
      label: (meta.theme + " " + meta.label).toLowerCase(),
      full: (meta.theme + " " + meta.label + " " + meta.question + " " + syn.join(" ")).toLowerCase(),
    };
  }
  return corpus;
}

/** Cheap suffix-stripping so "trusts"/"trust", "regions"/"region" etc. match across query and corpus. */
function qaVariants(token) {
  const v = new Set([token]);
  if (token.length > 4 && token.endsWith("es")) v.add(token.slice(0, -2));
  if (token.length > 3 && token.endsWith("s")) v.add(token.slice(0, -1));
  if (token.length > 4 && token.endsWith("ing")) v.add(token.slice(0, -3));
  if (token.length > 4 && token.endsWith("ed")) v.add(token.slice(0, -2));
  return [...v];
}

function qaHasWord(text, phrase) {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + esc + "\\b", "i").test(text);
}

/** Detect demographic filters mentioned in the query text. Returns {field:value,...} */
function qaDetectFilters(qLower, regionNames) {
  const filters = {};
  for (const r of regionNames) { if (qaHasWord(qLower, r.toLowerCase())) { filters.region = r; break; } }
  for (const [term, val] of Object.entries(QA.GENDER_TERMS)) if (qaHasWord(qLower, term)) { filters.gender = val; break; }
  for (const [term, val] of Object.entries(QA.SETTING_TERMS)) if (qaHasWord(qLower, term)) { filters.urbrur = val; break; }
  for (const [term, val] of Object.entries(QA.AGE_TERMS)) if (qaHasWord(qLower, term)) { filters.age_group = val; break; }
  for (const [term, val] of Object.entries(QA.EDU_TERMS)) if (qaHasWord(qLower, term)) { filters.education = val; break; }
  for (const [term, val] of Object.entries(QA.LPI_TERMS)) if (qaHasWord(qLower, term)) { filters.lpi_cat = val; break; }
  return filters;
}

function qaDetectSuperlative(qLower) {
  if (/\b(highest|most|top|greatest|strongest)\b/.test(qLower)) return "top";
  if (/\b(lowest|least|worst|weakest|smallest)\b/.test(qLower)) return "bottom";
  return null;
}

/** Score every indicator: label matches weigh 3x, generic corpus matches weigh 1x. Returns sorted [[key,score],...] */
function qaRankIndicators(qLower, corpus) {
  const tokens = qaTokens(qLower);
  const scores = Object.entries(corpus).map(([key, { label, full }]) => {
    let score = 0;
    for (const t of tokens) {
      const variants = qaVariants(t);
      const hitsLabel = variants.some(v => qaHasWord(label, v));
      const hitsFull = variants.some(v => qaHasWord(full, v));
      if (hitsLabel) score += 3;
      else if (hitsFull) score += 1;
    }
    return [key, score];
  });
  scores.sort((a, b) => b[1] - a[1]);
  return scores;
}

/**
 * Main entry point. `ctx` supplies the stats helpers + data so this file has
 * no hard dependency load-order requirement on app.js internals.
 */
function qaAnswer(queryText, ctx) {
  const { records, indicators, regionNames, applyFilters, weightedDistribution, weightedFavorable, groupFavorable } = ctx;
  const qLower = queryText.toLowerCase().trim();
  if (!qLower) return { ok: false, message: "Type a question about the survey to get started." };

  const corpus = ctx.corpus || (ctx.corpus = qaBuildCorpus(indicators));
  const filters = qaDetectFilters(qLower, regionNames);
  const superlative = qaDetectSuperlative(qLower);
  const ranked = qaRankIndicators(qLower, corpus);
  const [topKey, topScore] = ranked[0] || [null, 0];

  if (!topKey || topScore === 0) {
    return {
      ok: false,
      message: "I couldn't match that to an indicator in the registry. Try mentioning a topic (economy, corruption, trust, water, internet…) or a region/group.",
      suggestions: ranked.slice(0, 4).map(([k]) => indicators[k].label),
    };
  }

  const meta = indicators[topKey];

  // Mode 1: superlative + no explicit region filter -> rank all regions
  if (superlative && !filters.region && meta.positive) {
    const groups = groupFavorable(records, topKey, "region");
    const entries = Object.entries(groups).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
    if (!entries.length) return { ok: false, message: "Not enough regional data for that indicator." };
    const picked = superlative === "top" ? entries[0] : entries[entries.length - 1];
    const other = superlative === "top" ? entries[entries.length - 1] : entries[0];
    return {
      ok: true, mode: "region-rank", varKey: topKey, meta,
      narrative: `On “${meta.label}”, <b>${picked[0]}</b> ranks ${superlative === "top" ? "highest" : "lowest"} at <b>${picked[1].pct}%</b> favourable (n=${picked[1].size}), versus <b>${other[1].pct}%</b> in ${other[0]}.`,
      chart: { type: "bar", labels: entries.map(([k]) => k), data: entries.map(([, v]) => v.pct), horizontal: true },
      question: meta.question,
    };
  }

  // Mode 2: explicit demographic filter(s) -> segment vs national
  if (Object.keys(filters).length && meta.positive) {
    const seg = applyFilters(records, filters);
    const segStat = weightedFavorable(seg, topKey);
    const natStat = weightedFavorable(records, topKey);
    const filterDesc = Object.entries(filters).map(([f, v]) => v).join(", ");
    const gap = (segStat.pct - natStat.pct);
    return {
      ok: true, mode: "segment", varKey: topKey, meta, filters,
      narrative: `Among <b>${filterDesc}</b> (n=${segStat.n}), <b>${segStat.pct}%</b> are favourable on “${meta.label}”, versus <b>${natStat.pct}%</b> nationally — a ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}-point difference.`,
      chart: { type: "bar", labels: ["National average", filterDesc], data: [natStat.pct, segStat.pct], horizontal: true },
      question: meta.question,
    };
  }

  // Mode 3: plain lookup — national stat + distribution + best/worst region if available
  const dist = weightedDistribution(records, topKey);
  if (meta.positive) {
    const nat = weightedFavorable(records, topKey);
    const byRegion = groupFavorable(records, topKey, "region");
    const entries = Object.entries(byRegion).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
    const bestRegion = entries[0], worstRegion = entries[entries.length - 1];
    let regionNote = "";
    if (bestRegion && worstRegion && bestRegion[0] !== worstRegion[0]) {
      regionNote = ` Regionally, ${bestRegion[0]} is highest (${bestRegion[1].pct}%) and ${worstRegion[0]} is lowest (${worstRegion[1].pct}%).`;
    }
    return {
      ok: true, mode: "lookup", varKey: topKey, meta,
      narrative: `<b>${nat.pct}%</b> of respondents (n=${nat.n}) are favourable on “${meta.label}”.${regionNote}`,
      chart: { type: "bar", labels: dist.labels, data: dist.pcts, horizontal: true },
      question: meta.question,
    };
  }
  return {
    ok: true, mode: "distribution", varKey: topKey, meta,
    narrative: `Here's the full distribution of responses (n=${dist.n}) for “${meta.label}”.`,
    chart: { type: "bar", labels: dist.labels, data: dist.pcts, horizontal: true },
    question: meta.question,
  };
}

/** A handful of hand-authored cross-cutting questions that don't map to one variable. */
function qaSpecialQuestions(ctx) {
  const { records, indicators, groupFavorable, weightedFavorable } = ctx;
  const specials = [];

  // 1. Region most satisfied with country direction
  {
    const groups = groupFavorable(records, "Q3", "region");
    const entries = Object.entries(groups).filter(([, v]) => v.pct !== null).sort((a, b) => b[1].pct - a[1].pct);
    specials.push({
      q: "Which region is most positive about the country's direction?",
      narrative: `<b>${entries[0][0]}</b> is most positive (${entries[0][1].pct}% say the country is going in the right direction), while <b>${entries[entries.length - 1][0]}</b> is least positive (${entries[entries.length - 1][1].pct}%).`,
      chart: { type: "bar", labels: entries.map(([k]) => k), data: entries.map(([, v]) => v.pct), horizontal: true },
    });
  }

  // 2. Least trusted institution
  {
    const trustVars = ["Q37A", "Q37B", "Q37C", "Q37G", "Q37I", "Q37K", "Q37M"];
    const stats = trustVars.map(v => ({ v, label: indicators[v].label.replace("Trust: ", ""), pct: weightedFavorable(records, v).pct }));
    stats.sort((a, b) => a.pct - b.pct);
    specials.push({
      q: "Which institution do Ghanaians trust the least — and the most?",
      narrative: `<b>${stats[0].label}</b> is the least trusted institution measured here (${stats[0].pct}% favourable), while <b>${stats[stats.length - 1].label}</b> is the most trusted (${stats[stats.length - 1].pct}%).`,
      chart: { type: "bar", labels: stats.map(s => s.label), data: stats.map(s => s.pct), horizontal: true },
    });
  }

  // 3. Biggest problem
  {
    const mip = {};
    let den = 0;
    for (const r of records) {
      const v = r.ind["Q46PT1"];
      if (!v) continue;
      mip[v] = (mip[v] || 0) + r.weight; den += r.weight;
    }
    const top = Object.entries(mip).map(([k, v]) => [k, +(100 * v / den).toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    specials.push({
      q: "What is the single biggest problem facing the country?",
      narrative: `<b>${top[0][0]}</b> is the most-named top problem, cited by <b>${top[0][1]}%</b> of respondents as their first-mentioned concern.`,
      chart: { type: "bar", labels: top.map(t => t[0]), data: top.map(t => t[1]), horizontal: true },
    });
  }

  // 4. Gender gap on "men have more right to a job"
  {
    const groups = groupFavorable(records, "Q49B", "gender");
    if (groups["Man"] && groups["Woman"]) {
      const gap = Math.abs(groups["Man"].pct - groups["Woman"].pct);
      specials.push({
        q: "Do men and women disagree on whether men should have priority for scarce jobs?",
        narrative: `${groups["Man"].pct}% of men disagree that men should have more right to a job than women, versus ${groups["Woman"].pct}% of women — a ${gap.toFixed(1)}-point gap.`,
        chart: { type: "bar", labels: ["Men", "Women"], data: [groups["Man"].pct, groups["Woman"].pct], horizontal: false },
      });
    }
  }

  // 5. Generational digital divide
  {
    const groups = groupFavorable(records, "Q90J", "age_group");
    const order = ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"];
    const entries = order.filter(a => groups[a]).map(a => [a, groups[a].pct]);
    specials.push({
      q: "Is there a generational gap in frequent internet use?",
      narrative: `Frequent internet use runs from <b>${entries[0][1]}%</b> among ${entries[0][0]}-year-olds down to <b>${entries[entries.length - 1][1]}%</b> among those ${entries[entries.length - 1][0]} — a clear generational divide.`,
      chart: { type: "bar", labels: entries.map(e => e[0]), data: entries.map(e => e[1]), horizontal: false },
    });
  }

  return specials;
}
