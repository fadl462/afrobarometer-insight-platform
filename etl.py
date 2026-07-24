#!/usr/bin/env python3
"""
Afrobarometer Round 9 Merged Dataset (39 countries) — ETL
Source: R9_Merge_39ctry_20Nov23_final__release_Updated_4Jun25-3.sav
        (official file from https://www.afrobarometer.org/data/merged-data/)

Produces a compact, columnar (structure-of-arrays), integer-coded JSON so a
53,444-respondent x ~90-indicator dataset stays small enough to ship to a
browser. Every indicator's value labels are pulled programmatically from the
.sav file's own embedded metadata (meta.variable_value_labels), so there is
no hand-typed label that could mismatch the source data.
"""
import json, os, re
import pyreadstat
import numpy as np
import pandas as pd

SRC = "R9_Merge_39ctry_20Nov23_final__release_Updated_4Jun25-3.sav"
OUT_DIR = "data"
os.makedirs(OUT_DIR, exist_ok=True)

NON_SUBSTANTIVE_PAT = re.compile(
    r"^(missing|refused|refused to answer|don'?[’]?t know.*|not applicable|"
    r"not asked in (the )?country|no further reply|does not know|"
    r"do not understand.*|not sure|inap\.?)$", re.IGNORECASE)

def is_substantive(label):
    return label is not None and not NON_SUBSTANTIVE_PAT.match(str(label).strip())

print("Loading .sav (metadata)...")
_, meta = pyreadstat.read_sav(SRC, metadataonly=True)
VVL = meta.variable_value_labels  # {varname: {code(float): label}}

print("Loading .sav (full data, labelled)...")
df, _ = pyreadstat.read_sav(SRC, apply_value_formats=True, formats_as_category=False)
print("Loaded", df.shape)

def ordered_labels(varname):
    """Return substantive value labels for `varname`, in ascending-code order, as they'd appear formatted."""
    vl = VVL.get(varname, {})
    items = sorted(vl.items(), key=lambda kv: kv[0])
    return [lab for code, lab in items if is_substantive(lab)]

# ---------------------------------------------------------------------------
# Indicator registry. Each entry:
#   theme, label (short title), question (paraphrase of official wording),
#   positive: list of label strings counted as "favourable" (or None if nominal)
# `order` is NOT hand-typed — it's derived from ordered_labels(var) at build time.
# ---------------------------------------------------------------------------
INDICATOR_DEFS = {
 # --- Direction & Economy ---
 "Q3":  ("Direction & Economy", "Direction of the country", "Would you say the country is going in the wrong direction or the right direction?", ["Going in the right direction"]),
 "Q4A": ("Direction & Economy", "Country's present economic condition", "In general, how would you describe the present economic condition of this country?", ["Fairly good", "Very good"]),
 "Q4B": ("Direction & Economy", "Your present living conditions", "In general, how would you describe your own present living conditions?", ["Fairly good", "Very good"]),
 "Q5A": ("Direction & Economy", "Economic condition vs 12 months ago", "How do you rate economic conditions in this country compared to 12 months ago?", ["Better", "Much better"]),
 "Q5B": ("Direction & Economy", "Economic outlook, next 12 months", "Do you expect economic conditions to be better or worse in 12 months' time?", ["Better", "Much better"]),

 # --- Lived Poverty ---
 "Q6A": ("Lived Poverty", "Gone without food", "Over the past year, how often have you or your family gone without enough food to eat?", ["Never"]),
 "Q6B": ("Lived Poverty", "Gone without clean water", "...gone without enough clean water for home use?", ["Never"]),
 "Q6C": ("Lived Poverty", "Gone without medical care", "...gone without medicines or medical treatment?", ["Never"]),
 "Q6D": ("Lived Poverty", "Gone without cooking fuel", "...gone without enough fuel to cook food?", ["Never"]),
 "Q6E": ("Lived Poverty", "Gone without a cash income", "...gone without a cash income?", ["Never"]),

 # --- Freedoms & Participation ---
 "Q8":  ("Freedoms & Participation", "Discuss politics", "When you get together with friends or family, how often do you discuss political matters?", ["Frequently"]),
 "Q9A": ("Freedoms & Participation", "Freedom to say what you think", "How free are you to say what you think?", ["Somewhat free", "Completely free"]),
 "Q9B": ("Freedoms & Participation", "Freedom to join any political organization", "How free are you to join any political organization?", ["Somewhat free", "Completely free"]),
 "Q9C": ("Freedoms & Participation", "Freedom to choose who to vote for", "How free are you to choose who to vote for without feeling pressured?", ["Somewhat free", "Completely free"]),
 "Q10A": ("Freedoms & Participation", "Attended a community meeting", "Have you attended a community meeting in the past year?", ["Yes, once or twice", "Yes, several times", "Yes, often"]),
 "Q10C": ("Freedoms & Participation", "Attended a demonstration or protest", "Have you attended a demonstration or protest march in the past year?", ["Yes, once or twice", "Yes, several times", "Yes, often"]),
 "Q13": ("Freedoms & Participation", "Voted in most recent national election", "In the last national election, did you vote, or not?", ["I voted in the election"]),
 "Q14A": ("Freedoms & Participation", "Freeness & fairness of last election", "How would you rate the freeness and fairness of the last national election?", ["Free and fair, but with minor problems", "Completely free and fair"]),

 # --- Democracy ---
 "Q22A": ("Democracy", "Reject one-party rule", "Would you disapprove of only one political party being allowed to stand for election?", ["Disapprove", "Strongly disapprove"]),
 "Q22B": ("Democracy", "Reject military rule", "Would you disapprove of the army coming in to govern the country?", ["Disapprove", "Strongly disapprove"]),
 "Q22C": ("Democracy", "Reject one-man rule", "Would you disapprove of elections and parliament being abolished so the president can decide everything?", ["Disapprove", "Strongly disapprove"]),
 "Q23": ("Democracy", "Support for democracy", "Which is closest to your view: democracy is preferable, a non-democratic government can sometimes be preferable, or it doesn't matter?", ["STATEMENT 1: Democracy is preferable to any other kind of government."], {"STATEMENT 1: Democracy is preferable to any other kind of government.": "Democracy preferable", "STATEMENT 2: In some circumstances, a non-democratic government can be preferable.": "Non-democratic OK sometimes", "STATEMENT 3: For someone like me, it doesn’t matter what kind of government we have.": "Doesn't matter"}),
 "Q24": ("Democracy", "Elections vs other methods of choosing leaders", "Statement 1: leaders should be chosen through regular, open, honest elections. Statement 2: other methods should be used since elections sometimes produce bad results.", ["Agree very strongly with 1", "Agree with 1"], {"Agree very strongly with 1": "Strongly favour elections", "Agree with 1": "Favour elections", "Agree with 2": "Favour other methods", "Agree very strongly with 2": "Strongly favour other methods", "Agree with neither": "Neither"}),
 "Q26": ("Democracy", "Democracy needs political party turnover", "Statement 1: it's better if power sometimes changes hands between parties. Statement 2: it's fine if one party always wins as long as elections are free and fair.", ["Agree very strongly with 1", "Agree with 1"], {"Agree very strongly with 1": "Strongly favour turnover", "Agree with 1": "Favour turnover", "Agree with 2": "OK if one party always wins", "Agree very strongly with 2": "Strongly OK if one party wins", "Agree with neither": "Neither"}),
 "Q29A": ("Democracy", "Presidential term limits", "Statement 1: the Constitution should limit the president to two terms. Statement 2: there should be no limit.", ["Agree very strongly with 1", "Agree with 1"], {"Agree very strongly with 1": "Strongly favour two-term limit", "Agree with 1": "Favour two-term limit", "Agree with 2": "Favour no limit", "Agree very strongly with 2": "Strongly favour no limit", "Agree with neither": "Neither"}),
 "Q30": ("Democracy", "Extent of democracy today", "How much of a democracy is this country today?", ["A democracy, but with minor problems", "A full democracy"]),
 "Q31": ("Democracy", "Satisfaction with democracy", "Overall, how satisfied are you with the way democracy works in this country?", ["Fairly satisfied", "Very satisfied"]),

 # --- Governance & Accountability ---
 "Q33E": ("Governance", "People treated unequally under the law", "In your opinion, how often are people treated unequally under the law?", ["Never", "Rarely"]),
 "Q33F": ("Governance", "Officials who commit crimes go unpunished", "How often do officials who commit crimes go unpunished?", ["Never", "Rarely"]),
 "Q33H": ("Governance", "Freedom of the news media", "How free is the news media to report and comment on the news without government censorship?", ["Somewhat free", "Completely free"]),
 "Q34A": ("Governance", "MPs listen to ordinary people", "How much of the time do you think Members of Parliament try their best to listen to what ordinary people have to say?", ["Often", "Always"]),
 "Q34B": ("Governance", "Local councillors listen to ordinary people", "...local government councillors?", ["Often", "Always"]),
 "Q47A": ("Governance", "Approval: President's performance", "Do you approve or disapprove of the way the President has performed over the past 12 months?", ["Approve", "Strongly approve"]),
 "Q47B": ("Governance", "Approval: MP's performance", "Do you approve or disapprove of the way your Member of Parliament has performed?", ["Approve", "Strongly approve"]),
 "Q47C": ("Governance", "Approval: local councillor's performance", "Do you approve or disapprove of the way your local government councillor has performed?", ["Approve", "Strongly approve"]),
 "Q46A": ("Governance", "Handling: managing the economy", "How well or badly is the government handling managing the economy?", ["Fairly well", "Very well"]),
 "Q46C": ("Governance", "Handling: creating jobs", "How well or badly is the government handling creating jobs?", ["Fairly well", "Very well"]),
 "Q46G": ("Governance", "Handling: basic health services", "How well or badly is the government handling improving basic health services?", ["Fairly well", "Very well"]),
 "Q46H": ("Governance", "Handling: educational needs", "How well or badly is the government handling addressing educational needs?", ["Fairly well", "Very well"]),
 "Q46I": ("Governance", "Handling: water and sanitation", "How well or badly is the government handling providing water and sanitation services?", ["Fairly well", "Very well"]),
 "Q46J": ("Governance", "Handling: fighting corruption", "How well or badly is the government handling fighting corruption?", ["Fairly well", "Very well"]),
 "Q46L": ("Governance", "Handling: electricity supply", "How well or badly is the government handling providing a reliable supply of electricity?", ["Fairly well", "Very well"]),
 "Q46P": ("Governance", "Handling: climate change", "How well or badly is the government handling addressing the problem of climate change?", ["Fairly well", "Very well"]),

 # --- Corruption ---
 "Q38A": ("Corruption", "Corruption: the Presidency", "How many of the following do you think are involved in corruption: the President and officials in his office?", ["None", "Some of them"]),
 "Q38B": ("Corruption", "Corruption: Members of Parliament", "...Members of Parliament?", ["None", "Some of them"]),
 "Q38C": ("Corruption", "Corruption: civil servants", "...civil servants?", ["None", "Some of them"]),
 "Q38E": ("Corruption", "Corruption: police", "...the Police?", ["None", "Some of them"]),
 "Q38F": ("Corruption", "Corruption: judges and magistrates", "...judges and magistrates?", ["None", "Some of them"]),
 "Q38G": ("Corruption", "Corruption: tax officials", "...tax officials?", ["None", "Some of them"]),
 "Q38J": ("Corruption", "Corruption: business executives", "...business executives?", ["None", "Some of them"]),
 "Q39A": ("Corruption", "Change in corruption, past year", "Over the past year, has the level of corruption increased, decreased, or stayed the same?", ["Decreased somewhat", "Decreased a lot"]),
 "Q39B": ("Corruption", "Can report corruption without fear", "Can ordinary people report corruption without fear, or do they risk retaliation?", ["Can report without fear"]),

 # --- Trust ---
 "Q37A": ("Trust", "Trust: the President", "How much do you trust the President?", ["Somewhat", "A lot"]),
 "Q37B": ("Trust", "Trust: Parliament", "How much do you trust Parliament / the National Assembly?", ["Somewhat", "A lot"]),
 "Q37C": ("Trust", "Trust: Electoral Commission", "How much do you trust the national Electoral Commission?", ["Somewhat", "A lot"]),
 "Q37E": ("Trust", "Trust: the ruling party", "How much do you trust the ruling party?", ["Somewhat", "A lot"]),
 "Q37F": ("Trust", "Trust: opposition parties", "How much do you trust opposition political parties?", ["Somewhat", "A lot"]),
 "Q37G": ("Trust", "Trust: the Police", "How much do you trust the Police?", ["Somewhat", "A lot"]),
 "Q37H": ("Trust", "Trust: the Army", "How much do you trust the Army?", ["Somewhat", "A lot"]),
 "Q37I": ("Trust", "Trust: the Courts", "How much do you trust the Courts of Law?", ["Somewhat", "A lot"]),
 "Q37J": ("Trust", "Trust: traditional leaders", "How much do you trust traditional leaders?", ["Somewhat", "A lot"]),
 "Q37K": ("Trust", "Trust: religious leaders", "How much do you trust religious leaders?", ["Somewhat", "A lot"]),

 # --- Public Services ---
 "Q40A": ("Public Services", "Contact with a public school (12 mo.)", "In the past 12 months, have you had contact with a public school?", ["Yes"]),
 "Q40C": ("Public Services", "Paid a bribe for school services", "How often did you have to pay a bribe for services from a public school?", ["Never"]),
 "Q41A": ("Public Services", "Contact with public clinic/hospital (12 mo.)", "In the past 12 months, have you had contact with a public clinic or hospital?", ["Yes"]),
 "Q41B": ("Public Services", "Ease of obtaining medical care", "How easy or difficult was it to obtain the medical care you needed?", ["Very easy", "Easy"]),
 "Q41C": ("Public Services", "Paid a bribe for medical care", "How often did you have to pay a bribe for medical care?", ["Never"]),
 "Q42A": ("Public Services", "Tried to obtain an ID document (12 mo.)", "In the past 12 months, have you tried to obtain an identity document?", ["Yes"]),
 "Q42B": ("Public Services", "Ease of obtaining an ID document", "How easy or difficult was it to obtain the document you needed?", ["Very easy", "Easy"]),
 "Q43A": ("Public Services", "Requested police assistance (12 mo.)", "In the past 12 months, have you requested assistance from the police?", ["Yes"]),
 "Q43C": ("Public Services", "Paid a bribe for police assistance", "How often did you have to pay a bribe to get police assistance?", ["Never"]),

 # --- Gender ---
 "Q20": ("Gender", "Women's chances for political leadership", "Statement 1: men make better political leaders and should be elected over women. Statement 2: women should have the same chance of election as men.", ["Agree with 2", "Agree very strongly with 2"], {"Agree with 2": "Favour equal chance", "Agree very strongly with 2": "Strongly favour equal chance", "Agree with 1": "Favour men as leaders", "Agree very strongly with 1": "Strongly favour men as leaders", "Agree with neither": "Neither"}),
 "Q21A": ("Gender", "Men should have more right to a job than women", "When jobs are scarce, men should have more right to a job than women. Agree or disagree?", ["Strongly disagree", "Disagree"]),
 "Q21B": ("Gender", "Women have equal right to own land", "Women should have the same rights as men to own and inherit land. Agree or disagree?", ["Agree", "Strongly agree"]),
 "Q49A": ("Gender", "Women and men have equal chance at a paying job", "In our country today, women and men have equal opportunities to get a job that pays a wage or salary. Agree or disagree?", ["Agree", "Strongly agree"]),
 "Q49B": ("Gender", "Women and men have equal chance to own/inherit land", "...equal opportunities to own and inherit land. Agree or disagree?", ["Agree", "Strongly agree"]),
 "Q50B": ("Gender", "Women who run for office face criticism", "If a woman in your community runs for elected office, how likely is she to be criticized, called names, or harassed?", ["Very unlikely", "Somewhat unlikely"]),

 # --- Digital Access & Infrastructure ---
 "Q90F": ("Digital Access", "Owns a mobile phone", "Do you personally own a mobile phone?", ["Yes (personally owns)"]),
 "Q90G": ("Digital Access", "Mobile phone has internet access", "Does your phone have access to the internet?", ["Yes (Have internet)"]),
 "Q90I": ("Digital Access", "Frequency of internet use", "How often do you use the internet?", ["A few times a week", "Every day"]),
 "Q92A": ("Infrastructure", "Electric connection from the grid", "Do you have an electric connection to your home from the national grid?", ["Yes"]),
 "Q92B": ("Infrastructure", "Reliability of electricity supply", "How often is electricity actually available from this connection?", ["Most of the time", "All of the time"]),

 # --- Media ---
 "Q74A": ("Media", "Get news from radio", "How often do you get news from the radio?", ["A few times a week", "Every day"]),
 "Q74D": ("Media", "Get news from the internet", "How often do you get news from the internet?", ["A few times a week", "Every day"]),
 "Q74E": ("Media", "Get news from social media", "How often do you get news from social media?", ["A few times a week", "Every day"]),

 # --- Climate ---
 "Q66A": ("Climate", "Severity of droughts, past decade", "Over the past 10 years, has the severity of droughts increased, decreased, or stayed the same?", None),
 "Q66B": ("Climate", "Severity of flooding, past decade", "...severity of flooding?", None),
 "Q67A": ("Climate", "Heard of climate change", "Have you heard about climate change?", ["Yes"]),
 "Q67B": ("Climate", "Climate change making life worse", "Do you think climate change is making life in this country better or worse?", ["Somewhat worse", "Much worse"]),
 "Q68B": ("Climate", "Government must act now on climate change", "It is important for government to take steps now to limit climate change, even if expensive. Agree or disagree?", ["Agree", "Strongly agree"]),

 # --- International ---
 "Q77": ("International", "China's economic influence", "How much influence do China's economic activities have on our economy?", None),
 "Q78A": ("International", "Influence of China", "Is the economic and political influence of China mostly positive or negative?", ["Somewhat positive", "Very positive"]),
 "Q78B": ("International", "Influence of the United States", "Is the economic and political influence of the United States mostly positive or negative?", ["Somewhat positive", "Very positive"]),
 "Q78C": ("International", "Influence of Japan", "Is the economic and political influence of Japan mostly positive or negative?", ["Somewhat positive", "Very positive"]),
 "Q78C1": ("International", "Influence of Russia", "Is the economic and political influence of Russia mostly positive or negative?", ["Somewhat positive", "Very positive"]),
 "Q78F": ("International", "Influence of the European Union", "Is the economic and political influence of the EU mostly positive or negative?", ["Somewhat positive", "Very positive"]),

 # --- Social Cohesion ---
 "Q84B": ("Social Cohesion", "Own ethnic group treated unfairly by government", "How often is your ethnic group treated unfairly by the government?", ["Never"]),
 "Q85A": ("Social Cohesion", "Strong ties with fellow citizens", "I feel strong ties with other citizens of this country. Agree or disagree?", ["Agree", "Strongly agree"]),
 "Q86A": ("Social Cohesion", "Trust other citizens", "How much do you trust other citizens of this country?", ["Somewhat", "A lot"]),
 "Q86F": ("Social Cohesion", "Trust people from other ethnic groups", "How much do you trust people from other ethnic groups?", ["Somewhat", "A lot"]),
 "Q88B": ("Social Cohesion", "Seen as a full citizen by others", "Other citizens think of me as a citizen just like them. Agree or disagree?", ["Agree", "Strongly agree"]),

 # --- Assets ---
 "Q90A": ("Assets", "Owns a radio", "Do you personally own a radio?", ["Yes (personally owns)"]),
 "Q90B": ("Assets", "Owns a television", "Do you personally own a television?", ["Yes (personally owns)"]),
 "Q90C": ("Assets", "Owns a motor vehicle", "Do you personally own a motor vehicle, car, or motorcycle?", ["Yes (personally owns)"]),
 "Q90E": ("Assets", "Owns a bank account", "Do you personally own a bank account?", ["Yes (personally owns)"]),

 # --- Most important problem (nominal, no positive set) ---
 "Q45PT1": ("Direction & Economy", "Most important problem facing the country", "In your opinion, what is the most important problem facing this country that government should address? (first-mentioned response)", None),
}

def build_indicators():
    registry = {}
    for var, tup in INDICATOR_DEFS.items():
        theme, label, question, positive = tup[0], tup[1], tup[2], tup[3]
        short_labels = tup[4] if len(tup) > 4 else None
        order = ordered_labels(var)
        entry = {"theme": theme, "label": label, "question": question, "order": order, "positive": positive}
        if short_labels:
            entry["short_labels"] = short_labels
        registry[var] = entry
    return registry

INDICATORS = build_indicators()
# sanity: warn if any declared "positive" label isn't actually present in that var's order
for var, meta_ in INDICATORS.items():
    if meta_["positive"]:
        missing = [p for p in meta_["positive"] if p not in meta_["order"]]
        if missing:
            print(f"WARNING {var}: positive labels not found in order: {missing} (order={meta_['order']})")

print(len(INDICATORS), "indicators defined")

# ---------------------------------------------------------------------------
# Demographic field derivation (reuse Afrobarometer's own pre-cleaned columns
# where available: AGE_v1, EDUC_COND, RELIG_COND, LivedPoverty/_CAT).
# ---------------------------------------------------------------------------
def s(colname):
    return df[colname]

def substantive_str(series):
    return series.where(series.map(lambda v: is_substantive(v) if isinstance(v, str) else True), None)

demo_country = df["COUNTRY"].astype(str)
demo_region = substantive_str(df["REGION"].astype(str))
demo_urbrur = substantive_str(df["URBRUR"].astype(str))
demo_gender = substantive_str(df["Q100"].astype(str))
age_numeric = pd.to_numeric(df["Q1"], errors="coerce")
demo_age = age_numeric.where(age_numeric.between(18, 120), None)
demo_age_group = substantive_str(df["AGE_v1"].astype(str)).str.replace("66 and over", "66+", regex=False)
demo_education = substantive_str(df["EDUC_COND"].astype(str))
demo_religion = substantive_str(df["RELIG_COND"].astype(str))
demo_lpi = df["LivedPoverty"].where(df["LivedPoverty"].notna(), None)
demo_lpi_cat = substantive_str(df["LivedPoverty_CAT"].astype(str))
demo_w_within = df["withinwt_hh"].fillna(1.0)
demo_w_combined = df["Combinwt_new_hh"].fillna(1.0)

def to_pylist(series):
    return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else (round(float(v), 3) if isinstance(v, (float, np.floating)) else v) for v in series]

DEMO_COLS = {
    "region": to_pylist(demo_region), "urbrur": to_pylist(demo_urbrur), "gender": to_pylist(demo_gender),
    "age": to_pylist(demo_age), "age_group": to_pylist(demo_age_group), "education": to_pylist(demo_education),
    "religion": to_pylist(demo_religion), "lpi": to_pylist(demo_lpi), "lpi_cat": to_pylist(demo_lpi_cat),
    "weight_within": to_pylist(demo_w_within), "weight_combined": to_pylist(demo_w_combined),
}

# Index-encode each indicator's responses against its own `order` list (small ints, not repeated label strings)
IND_CODES = {}
for var, m in INDICATORS.items():
    order_index = {label: i for i, label in enumerate(m["order"])}
    raw = df[var].astype(object)
    codes = []
    for v in raw:
        if isinstance(v, str) and v in order_index:
            codes.append(order_index[v])
        else:
            codes.append(None)
    IND_CODES[var] = codes

country_names = sorted(demo_country.unique().tolist())
print(len(country_names), "countries")

# ---------------------------------------------------------------------------
# Per-country microdata files (columnar + int-coded), loaded on demand by the
# frontend when a country is selected for deep-dive exploration.
# ---------------------------------------------------------------------------
country_dir = os.path.join(OUT_DIR, "countries")
os.makedirs(country_dir, exist_ok=True)

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

country_manifest = []
n_total = len(df)
country_mask_cache = {}

for cname in country_names:
    mask = (demo_country == cname).values
    country_mask_cache[cname] = mask
    idx = np.nonzero(mask)[0]
    n_c = len(idx)
    slug = slugify(cname)
    regions_c = sorted(set(x for x in (DEMO_COLS["region"][i] for i in idx) if x))

    payload = {
        "country": cname, "n": n_c, "regions": regions_c,
        "demo": {k: [v[i] for i in idx] for k, v in DEMO_COLS.items()},
        "ind": {var: [codes[i] for i in idx] for var, codes in IND_CODES.items()},
    }
    with open(os.path.join(country_dir, f"{slug}.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    country_manifest.append({"name": cname, "slug": slug, "n": n_c, "regions": len(regions_c)})
    print(f"  wrote {slug}.json  n={n_c}")

# ---------------------------------------------------------------------------
# Cross-country aggregates (precomputed) — powers Compare Countries / Africa
# Explorer instantly without shipping all 39 countries' microdata up front.
# Uses within-country weight for each country's own %, and the official
# multi-country weighting factor (Combinwt_new_hh) for the continental figure.
# ---------------------------------------------------------------------------
def weighted_pct_vec(mask, codes_np, weights_np, positive_idx_set):
    sub_codes = codes_np[mask]
    sub_weights = weights_np[mask]
    valid = ~np.isnan(sub_codes)
    n = int(valid.sum())
    if n == 0:
        return None, 0
    vw = sub_weights[valid]
    den = vw.sum()
    if den <= 0:
        return None, n
    in_pos = np.isin(sub_codes[valid], list(positive_idx_set))
    num = vw[in_pos].sum()
    return round(100 * num / den, 1), n

by_indicator = {}
w_within_np = np.array([np.nan if v is None else v for v in DEMO_COLS["weight_within"]], dtype=float)
w_combined_np = np.array([np.nan if v is None else v for v in DEMO_COLS["weight_combined"]], dtype=float)
country_mask_np = {c: np.asarray(m) for c, m in country_mask_cache.items()}
all_mask_np = np.ones(n_total, dtype=bool)

for var, m in INDICATORS.items():
    if not m["positive"]:
        continue
    positive_idx = {i for i, lab in enumerate(m["order"]) if lab in m["positive"]}
    codes_np = np.array([np.nan if v is None else float(v) for v in IND_CODES[var]], dtype=float)
    entry = {}
    for cname in country_names:
        pct, n = weighted_pct_vec(country_mask_np[cname], codes_np, w_within_np, positive_idx)
        entry[cname] = {"pct": pct, "n": n}
    cont_pct, cont_n = weighted_pct_vec(all_mask_np, codes_np, w_combined_np, positive_idx)
    entry["__continental__"] = {"pct": cont_pct, "n": cont_n}
    by_indicator[var] = entry
    print("aggregated", var)

with open(os.path.join(OUT_DIR, "country_aggregates.json"), "w", encoding="utf-8") as f:
    json.dump({"by_indicator": by_indicator}, f, ensure_ascii=False, separators=(",", ":"))

with open(os.path.join(OUT_DIR, "indicators.json"), "w", encoding="utf-8") as f:
    json.dump(INDICATORS, f, indent=2, ensure_ascii=False)

meta_out = {
    "dataset": "Afrobarometer Round 9 Merged Data (39 countries)",
    "round": 9, "n_total": n_total,
    "countries": country_manifest,
    "citation": "Afrobarometer Data, Merged Round 9 (39 countries), 2021-2023, available at http://www.afrobarometer.org.",
    "codebook_source": "AB_R9_MergeCodebook_25Jun24_final.pdf, Afrobarometer",
    "source_file": "R9_Merge_39ctry_20Nov23_final__release_Updated_4Jun25-3.sav",
    "weighting_note": "Per-country statistics use withinwt_hh (within-country weight). Continental/cross-country aggregates use Combinwt_new_hh (Afrobarometer's official multi-country weighting factor), which gives each of the 39 countries equal weight regardless of population, matching Afrobarometer's own published cross-country reporting convention.",
}
with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
    json.dump(meta_out, f, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------------------
# Continental summary: headline KPIs (pulled from country_aggregates'
# __continental__ entries) + most-important-problem ranking (Q45PT1 is
# nominal, so it isn't in country_aggregates; computed separately here).
# ---------------------------------------------------------------------------
mip_order = INDICATORS["Q45PT1"]["order"]
mip_codes = np.array([np.nan if v is None else float(v) for v in IND_CODES["Q45PT1"]], dtype=float)
valid = ~np.isnan(mip_codes)
den = w_combined_np[valid].sum()
mip_weighted = {}
for i, label in enumerate(mip_order):
    sel = valid & (mip_codes == i)
    mip_weighted[label] = round(100 * w_combined_np[sel].sum() / den, 1) if den else 0
top_mip = sorted(mip_weighted.items(), key=lambda kv: -kv[1])[:8]

def cont(var):
    return by_indicator.get(var, {}).get("__continental__", {"pct": None, "n": 0})

continental = {
    "n_total": n_total,
    "n_countries": len(country_names),
    "headline": {
        "econ_condition_positive_pct": cont("Q4A")["pct"],
        "support_democracy_pct": cont("Q23")["pct"],
        "satisfied_democracy_pct": cont("Q31")["pct"],
        "president_approval_pct": cont("Q47A")["pct"],
        "corruption_worsened_pct": None,  # Q39A "positive" is decrease; worsened = increased categories, compute directly below
        "trust_president_pct": cont("Q37A")["pct"],
        "trust_police_pct": cont("Q37G")["pct"],
        "internet_access_pct": cont("Q90G")["pct"],
        "electricity_access_pct": cont("Q92A")["pct"],
    },
    "top_problems": [{"problem": k, "pct": v} for k, v in top_mip],
}
# corruption "worsened" = Increased a lot / Increased somewhat (inverse of the registry's "positive"=decreased set)
q39_order = INDICATORS["Q39A"]["order"]
q39_codes = np.array([np.nan if v is None else float(v) for v in IND_CODES["Q39A"]], dtype=float)
worsened_idx = {i for i, lab in enumerate(q39_order) if lab in ("Increased a lot", "Increased somewhat")}
pct, n = weighted_pct_vec(all_mask_np, q39_codes, w_combined_np, worsened_idx)
continental["headline"]["corruption_worsened_pct"] = pct

with open(os.path.join(OUT_DIR, "continental.json"), "w", encoding="utf-8") as f:
    json.dump(continental, f, indent=2, ensure_ascii=False)

print("DONE.")
print(f"n_total={n_total}, countries={len(country_names)}, indicators={len(INDICATORS)}")
