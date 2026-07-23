#!/usr/bin/env python3
"""
Afrobarometer Ghana Round 10 - ETL
Source CSV uses value LABELS (strings), not numeric codes.
Converts raw CSV microdata into structured JSON for the Insight Platform.
Labels verified against: AB_R10.Codebook_Ghana_30June25.pdf (Afrobarometer, official, 25 Jul 2025).
"""
import csv, json, os, re, collections

SRC = "GHA_R10.Data_03Oct24.wtd.final.release_updated.13Feb25.csv"  # place the raw Afrobarometer CSV export alongside this script
OUT_DIR = "data"
os.makedirs(OUT_DIR, exist_ok=True)

NON_SUBSTANTIVE = {
    "", "refused", "refused to answer", "refused to answer.", "don't know",
    "don't know/haven't heard enough to say", "don't know / haven't heard enough to say",
    "don't know/ haven't heard", "don't know or haven't heard enough to say",
    "not applicable", "not asked in country", "not asked in the country",
    "no further reply", "missing", "does not know",
}

def norm(s):
    return re.sub(r"\s+", " ", s).strip().lower().replace("’", "'")

def clean(raw):
    if raw is None:
        return None
    s = raw.strip()
    if norm(s) in NON_SUBSTANTIVE or norm(s).startswith("don't know") or norm(s).startswith("refused"):
        return None
    return s

def age_group(age):
    if age is None: return None
    try:
        a = int(age)
    except ValueError:
        return None
    if a < 18: return None
    if a <= 25: return "18-25"
    if a <= 35: return "26-35"
    if a <= 45: return "36-45"
    if a <= 55: return "46-55"
    if a <= 65: return "56-65"
    return "66+"

def edu_group(v):
    if v is None: return None
    v = norm(v)
    if "no formal" in v: return "No formal schooling"
    if "informal" in v: return "No formal schooling"
    if "primary" in v: return "Primary"
    if "intermediate" in v or "some secondary" in v or ("secondary" in v and "post" not in v): return "Secondary"
    if "post-secondary" in v: return "Post-secondary (non-university)"
    if "university" in v or "post-graduate" in v: return "University"
    return None

def employ_group(v):
    if v is None: return None
    v = norm(v)
    if "not looking" in v: return "Not in labour force"
    if "looking" in v: return "Unemployed, looking for work"
    if "part time" in v: return "Employed, part-time"
    if "full time" in v: return "Employed, full-time"
    return None

def religion_group(v):
    if v is None: return "No religion / not stated"
    v = norm(v)
    if v == "none": return "No religion / not stated"
    if "traditional" in v: return "Traditional / ethnic religion"
    if "muslim" in v or "sunni" in v or "ismaeli" in v or "brotherhood" in v or "shia" in v:
        return "Muslim"
    if "agnostic" in v or "atheist" in v: return "No religion / not stated"
    return "Christian"

MAJOR_ETHNIC = {"akan", "ewe/anlo", "dagomba", "ga/adangbe", "gurma", "frafra",
                "gonja", "dagaare", "kusaal", "grusi", "sisala", "mande", "guan",
                "hausa", "buli", "waale"}

def ethnicity_group(v):
    if v is None: return None
    vn = norm(v)
    if "national identity" in vn: return "Ghanaian identity only"
    if vn in MAJOR_ETHNIC:
        return v.strip()
    return "Other / smaller groups"

def to_num(v):
    if v is None: return None
    try:
        return float(v)
    except ValueError:
        return None

def lpi_cat(nums):
    avg = sum(nums) / 5.0
    if avg == 0: cat = "No lived poverty"
    elif avg <= 1.0: cat = "Low lived poverty"
    elif avg <= 2.0: cat = "Moderate lived poverty"
    else: cat = "High lived poverty"
    return round(avg, 3), cat

REGION_TITLE = {
    "WESTERN": "Western", "WESTERN NORTH": "Western North", "CENTRAL": "Central",
    "GREATER ACCRA": "Greater Accra", "VOLTA": "Volta", "OTI": "Oti",
    "EASTERN": "Eastern", "ASHANTI": "Ashanti", "AHAFO": "Ahafo", "BONO": "Bono",
    "BONO EAST": "Bono East", "NORTHERN": "Northern", "SAVANNAH": "Savannah",
    "NORTH EAST": "North East", "UPPER EAST": "Upper East", "UPPER WEST": "Upper West",
}

# ---------------------------------------------------------------------------
FREQ4 = ["Never", "Just once or twice", "Several times", "Many times", "Always"]
HAND4 = ["Very badly", "Fairly badly", "Fairly well", "Very well"]
TRUST4 = ["Not at all", "Just a little", "Somewhat", "A lot"]
CORR4 = ["None", "Some of them", "Most of them", "All of them"]
AGREE5 = ["Strongly disagree", "Disagree", "Neither Agree nor disagree", "Agree", "Strongly agree"]
FREQ4B = ["Never", "Once or twice", "A few times", "Often"]
USE5 = ["Never", "Less than once a month", "A few times a month", "A few times a week", "Every day"]

INDICATORS = {
 "Q3":  {"theme":"Direction & Economy","label":"Direction of the country","question":"Would you say the country is going in the wrong direction or the right direction?","order":["Going in the wrong direction","Going in the right direction"],"positive":["Going in the right direction"]},
 "Q4A": {"theme":"Direction & Economy","label":"Country's present economic condition","question":"In general, how would you describe the present economic condition of this country?","order":["Very bad","Fairly bad","Neither good nor bad","Fairly good","Very good"],"positive":["Fairly good","Very good"]},
 "Q4B": {"theme":"Direction & Economy","label":"Your present living conditions","question":"In general, how would you describe your own present living conditions?","order":["Very bad","Fairly bad","Neither good nor bad","Fairly good","Very good"],"positive":["Fairly good","Very good"]},
 "Q5A": {"theme":"Direction & Economy","label":"Economic condition vs 12 months ago","question":"Looking back, how do you rate economic conditions in this country compared to 12 months ago?","order":["Much worse","Worse","Same","Better","Much better"],"positive":["Better","Much better"]},
 "Q6":  {"theme":"Direction & Economy","label":"Economic outlook, next 12 months","question":"Looking ahead, do you expect economic conditions in this country to be better or worse in 12 months' time?","order":["Much worse","Worse","Same","Better","Much better"],"positive":["Better","Much better"]},
 "Q7A": {"theme":"Lived Poverty","label":"Gone without food","question":"Over the past year, how often, if ever, have you or your family gone without enough food to eat?","order":FREQ4,"positive":["Never"]},
 "Q7B": {"theme":"Lived Poverty","label":"Gone without clean water","question":"...gone without enough clean water for home use?","order":FREQ4,"positive":["Never"]},
 "Q7C": {"theme":"Lived Poverty","label":"Gone without medical care","question":"...gone without medicines or medical treatment?","order":FREQ4,"positive":["Never"]},
 "Q7D": {"theme":"Lived Poverty","label":"Gone without cooking fuel","question":"...gone without enough fuel to cook food?","order":FREQ4,"positive":["Never"]},
 "Q7E": {"theme":"Lived Poverty","label":"Gone without a cash income","question":"...gone without a cash income?","order":FREQ4,"positive":["Never"]},
 "Q10A":{"theme":"Democracy","label":"Freedom to say what you think","question":"In this country, how free are you to say what you think?","order":["Not at all free","Not very free","Somewhat free","Completely free"],"positive":["Somewhat free","Completely free"]},
 "Q22": {"theme":"Democracy","label":"Support for democracy","question":"Which is closest to your view? (1) doesn't matter what government we have; (2) non-democratic government can be preferable; (3) democracy is preferable to any other kind of government.","order":["STATEMENT 3: For someone like me, it doesn’t matter what kind of government we have.","STATEMENT 2: In some circumstances, a non-democratic government can be preferable.","STATEMENT 1: Democracy is preferable to any other kind of government."],"positive":["STATEMENT 1: Democracy is preferable to any other kind of government."],"short_labels":{"STATEMENT 3: For someone like me, it doesn’t matter what kind of government we have.":"Doesn't matter","STATEMENT 2: In some circumstances, a non-democratic government can be preferable.":"Non-democratic OK sometimes","STATEMENT 1: Democracy is preferable to any other kind of government.":"Democracy preferable"}},
 "Q32": {"theme":"Democracy","label":"Extent of democracy today","question":"In your opinion how much of a democracy is Ghana today?","order":["Not a democracy","A democracy, with major problems","A democracy, but with minor problems","A full democracy"],"positive":["A democracy, but with minor problems","A full democracy"]},
 "Q33": {"theme":"Democracy","label":"Satisfaction with democracy","question":"Overall, how satisfied are you with the way democracy works in Ghana?","order":["The country is not a democracy","Not at all satisfied","Not very satisfied","Fairly satisfied","Very satisfied"],"positive":["Fairly satisfied","Very satisfied"]},
 "Q29": {"theme":"Democracy","label":"Presidential term limits","question":"Statement 1: the Constitution should limit the president to two terms. Statement 2: there should be no limit.","order":["Agree with 1","Agree with 2","Agree with neither"],"positive":["Agree with 1"],"short_labels":{"Agree with 1":"Two-term limit","Agree with 2":"No term limits","Agree with neither":"Neither"}},
 "Q15": {"theme":"Elections","label":"Freeness & fairness of last election","question":"On the whole, how would you rate the freeness and fairness of the last national election (Dec 2020)?","order":["Not free and fair","Free and fair, but with major problems","Free and fair, but with minor problems","Completely free and fair"],"positive":["Free and fair, but with minor problems","Completely free and fair"]},
 "Q13A":{"theme":"Elections","label":"Voted in most recent national election","question":"In the last national election, did you vote, or not?","order":["I did not vote","I was too young to vote","I can’t remember whether I voted","I voted in the election"],"positive":["I voted in the election"]},
 "Q34C":{"theme":"Governance","label":"Judges/magistrates favor political influence over law","question":"How often do judges and magistrates favor political considerations over the law?","order":FREQ4[:4],"positive":["Never","Rarely"]},
 "Q34D":{"theme":"Governance","label":"People treated unequally under the law","question":"How often are people treated unequally under the law?","order":FREQ4[:4],"positive":["Never","Rarely"]},
 "Q35": {"theme":"Governance","label":"Freedom of the news media","question":"How free is the news media to report and comment on the news without government censorship?","order":["Not at all free","Not very free","Somewhat free","Completely free"],"positive":["Somewhat free","Completely free"]},
 "Q48A":{"theme":"Governance","label":"Approval: President's performance","question":"Do you approve or disapprove of the way the President has performed over the past 12 months?","order":["Strongly disapprove","Disapprove","Approve","Strongly approve"],"positive":["Approve","Strongly approve"]},
 "Q48B":{"theme":"Governance","label":"Approval: your Member of Parliament","question":"Do you approve or disapprove of the way your MP has performed?","order":["Strongly disapprove","Disapprove","Approve","Strongly approve"],"positive":["Approve","Strongly approve"]},
 "Q47A":{"theme":"Governance","label":"Handling: managing the economy","question":"How well or badly is the government handling: managing the economy?","order":HAND4,"positive":["Fairly well","Very well"]},
 "Q47C":{"theme":"Governance","label":"Handling: creating jobs","question":"How well or badly is the government handling: creating jobs?","order":HAND4,"positive":["Fairly well","Very well"]},
 "Q47J":{"theme":"Governance","label":"Handling: fighting corruption","question":"How well or badly is the government handling: fighting corruption?","order":HAND4,"positive":["Fairly well","Very well"]},
 "Q47G":{"theme":"Governance","label":"Handling: basic health services","question":"How well or badly is the government handling: improving basic health services?","order":HAND4,"positive":["Fairly well","Very well"]},
 "Q47H":{"theme":"Governance","label":"Handling: educational needs","question":"How well or badly is the government handling: addressing educational needs?","order":HAND4,"positive":["Fairly well","Very well"]},
 "Q47L":{"theme":"Governance","label":"Handling: electricity supply","question":"How well or badly is the government handling: providing a reliable supply of electricity?","order":HAND4,"positive":["Fairly well","Very well"]},
 "Q38A":{"theme":"Corruption","label":"Corruption: Office of the Presidency","question":"How many of the following do you think are involved in corruption: the President and officials in his office?","order":CORR4,"positive":["None","Some of them"]},
 "Q38B":{"theme":"Corruption","label":"Corruption: Members of Parliament","question":"...Members of Parliament?","order":CORR4,"positive":["None","Some of them"]},
 "Q38E":{"theme":"Corruption","label":"Corruption: Police","question":"...the Police?","order":CORR4,"positive":["None","Some of them"]},
 "Q38G":{"theme":"Corruption","label":"Corruption: Tax officials","question":"...Tax officials?","order":CORR4,"positive":["None","Some of them"]},
 "Q39A":{"theme":"Corruption","label":"Change in corruption, past year","question":"Over the past year, has the level of corruption increased, decreased, or stayed the same?","order":["Increased a lot","Increased somewhat","Stayed the same","Decreased somewhat","Decreased a lot"],"positive":["Decreased somewhat","Decreased a lot"]},
 "Q39B":{"theme":"Corruption","label":"Can report corruption without fear","question":"Can ordinary people report corruption without fear, or do they risk retaliation?","order":["Can report without fear","Risk retaliation or other negative consequences"],"positive":["Can report without fear"]},
 "Q37A":{"theme":"Trust","label":"Trust: the President","question":"How much do you trust the President?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q37B":{"theme":"Trust","label":"Trust: Parliament","question":"How much do you trust Parliament?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q37C":{"theme":"Trust","label":"Trust: Electoral Commission","question":"How much do you trust the National Electoral Commission?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q37G":{"theme":"Trust","label":"Trust: the Police","question":"How much do you trust the Police?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q37I":{"theme":"Trust","label":"Trust: the Courts","question":"How much do you trust the Courts of Law?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q37K":{"theme":"Trust","label":"Trust: Traditional leaders","question":"How much do you trust Traditional leaders?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q37M":{"theme":"Trust","label":"Trust: NGOs / civil society","question":"How much do you trust Non-Governmental Organisations?","order":TRUST4,"positive":["Somewhat","A lot"]},
 "Q49B":{"theme":"Gender","label":"Men should have more right to a job than women","question":"When jobs are scarce, men should have more right to a job than women. Agree or disagree?","order":AGREE5,"positive":["Strongly disagree","Disagree"]},
 "Q51": {"theme":"Gender","label":"Women's chances for political leadership","question":"Statement 1: men make better leaders and should be elected over women. Statement 2: women should have the same chance of election as men.","order":["Agree with 1","Agree with 2","Agree with neither"],"positive":["Agree with 2"],"short_labels":{"Agree with 1":"Men make better leaders","Agree with 2":"Equal chance for women","Agree with neither":"Neither"}},
 "Q53A":{"theme":"Gender","label":"Police/courts protect women & girls","question":"Are police and courts doing enough to protect women and girls, or do they need to do more?","order":["Need to do much more","Need to do somewhat more","Doing enough"],"positive":["Doing enough"]},
 "Q86C":{"theme":"Gender","label":"Girls should continue school through pregnancy","question":"Girls who become pregnant should be able to continue their education. Agree or disagree?","order":AGREE5,"positive":["Agree","Strongly agree"]},
 "Q86D":{"theme":"Gender","label":"Sex education should be taught in schools","question":"Sex education should be taught in schools. Agree or disagree?","order":AGREE5,"positive":["Agree","Strongly agree"]},
 "Q50": {"theme":"Youth","label":"Top priority for youth investment","question":"Which of these should be the top priority for government investment in youth programs?","order":["Job creation","Education","Jobs training","Access to business loans","Social services for youth, for example, to improve health and prevent drug abuse","None of the above/some other programs","Government should not increase its spending on programs to help young people"],"positive":None},
 "Q94D":{"theme":"Youth","label":"Main barrier to youth employment","question":"What is the main barrier keeping young people from finding employment?","order":["Youth do not face barriers to getting employment","Lack of adequate training or preparation","Lack of experience required by employers","Youth are unwilling to work certain jobs (e.g., in agriculture or difficult jobs)","Youth lack of entrepreneurial skills or motivation","There is a mismatch between education qualifications and job requirements","Some other barrier"],"positive":None},
 "Q40A":{"theme":"Public Services","label":"Contact with public clinic/hospital (12 mo.)","question":"In the past 12 months, have you had contact with a public clinic or hospital?","order":["No","Yes"],"positive":None},
 "Q40B":{"theme":"Public Services","label":"Ease of obtaining medical care","question":"How easy or difficult was it to obtain the medical care you needed?","order":["Very easy","Easy","Difficult","Very Difficult"],"positive":["Very easy","Easy"]},
 "Q40C":{"theme":"Public Services","label":"Paid a bribe for medical care","question":"How often did you have to pay a bribe for medical care?","order":FREQ4B,"positive":["Never"]},
 "Q44A":{"theme":"Public Services","label":"Tried to obtain an ID document (12 mo.)","question":"In the past 12 months, have you tried to obtain an identity document (birth certificate, passport, voter's card, etc.)?","order":["No","Yes"],"positive":None},
 "Q44B":{"theme":"Public Services","label":"Ease of obtaining an ID document","question":"How easy or difficult was it to obtain the document you needed?","order":["Very easy","Easy","Difficult","Very Difficult"],"positive":["Very easy","Easy"]},
 "Q93A":{"theme":"Infrastructure","label":"Electric connection from the grid","question":"Do you have an electric connection to your home from the national grid?","order":["No","Yes"],"positive":["Yes"]},
 "Q93B":{"theme":"Infrastructure","label":"Reliability of electricity supply","question":"How often is electricity actually available from this connection?","order":["Never","Occasionally","About half of the time","Most of the time","All of the time"],"positive":["Most of the time","All of the time"]},
 "Q92": {"theme":"Infrastructure","label":"Main source of drinking water","question":"What is your main source of water for household use?","order":["Piped public or community water system","Tubewell or borehole","Dug well that is protected","Dug well that is not protected","Spring that is protected","Spring that is unprotected","Rainwater","Bottled water","Purchased from a cart or truck","Surface water, like a river, dam, lake, pond, stream, canal, or irrigation channel"],"positive":["Piped public or community water system","Tubewell or borehole","Dug well that is protected","Spring that is protected","Bottled water"]},
 "Q90H":{"theme":"Digital Access","label":"Mobile phone has internet access","question":"Does your phone have access to the internet?","order":["No (Does not have Internet access)","Yes (Has Internet access)"],"positive":["Yes (Has Internet access)"]},
 "Q90J":{"theme":"Digital Access","label":"Frequency of internet use","question":"How often do you use the internet?","order":USE5,"positive":["A few times a week","Every day"]},
 "Q90G":{"theme":"Digital Access","label":"Owns a mobile money account","question":"Do you personally own a mobile money account?","order":["No, no one in the household owns","Someone else in household owns","Yes (personally owns)"],"positive":["Yes (personally owns)"]},
 "Q65A":{"theme":"Media","label":"Get news from radio","question":"How often do you get news from the radio?","order":USE5,"positive":["A few times a week","Every day"]},
 "Q65D":{"theme":"Media","label":"Get news from social media","question":"How often do you get news from social media (Facebook, WhatsApp, etc.)?","order":USE5,"positive":["A few times a week","Every day"]},
 "Q60A":{"theme":"Climate","label":"Heard of climate change","question":"Have you heard about climate change?","order":["No","Yes"],"positive":["Yes"]},
 "Q60B":{"theme":"Climate","label":"Climate change making life worse","question":"Do you think climate change is making life in Ghana better or worse?","order":["Much better","Somewhat better","Neither/ no change / about the same","Somewhat worse","Much worse"],"positive":["Somewhat worse","Much worse"]},
 "Q62A":{"theme":"Climate","label":"Government must act now on climate change","question":"It is important for our government to take steps now to limit climate change, even if expensive. Agree or disagree?","order":AGREE5,"positive":["Agree","Strongly agree"]},
 "Q59A":{"theme":"Climate","label":"Severity of droughts, past decade","question":"Over the past 10 years, has the severity of droughts increased, decreased, or stayed the same?","order":["Much more severe","Somewhat more severe","Stayed the same","Somewhat less severe","Much less severe"],"positive":None},
 "Q59B":{"theme":"Climate","label":"Severity of flooding, past decade","question":"...severity of flooding?","order":["Much more severe","Somewhat more severe","Stayed the same","Somewhat less severe","Much less severe"],"positive":None},
 "Q9":  {"theme":"Security","label":"Felt unsafe in home / neighbourhood","question":"Over the past year, how often have you or your family felt unsafe walking in your neighbourhood or in your own home?","order":FREQ4,"positive":["Never"]},
 "Q45D":{"theme":"Security","label":"Contact with police (checkpoints, stops etc.)","question":"In the past 12 months, how often have you encountered the police in situations like checkpoints or traffic stops?","order":FREQ4B,"positive":None},
 "Q71A":{"theme":"Migration","label":"Considered emigrating","question":"Have you considered emigrating to another country?","order":["Not at all","A little bit","Somewhat","A lot"],"positive":["Not at all"]},
 "Q66": {"theme":"International","label":"China's economic influence","question":"How much influence do you think China's economic activities have on our economy?","order":["None","A little","Somewhat","A lot"],"positive":None},
 "Q67C":{"theme":"International","label":"Influence of the United States","question":"Is the economic and political influence of the United States on Ghana mostly positive or negative?","order":["Very negative","Somewhat negative","Neither positive nor negative","Somewhat positive","Very positive"],"positive":["Somewhat positive","Very positive"]},
 "Q46PT1":{"theme":"Direction & Economy","label":"Most important problem facing the country","question":"In your opinion, what is the most important problem facing this country that government should address? (first-mentioned response)","order":["Management of the economy","Wages, incomes and salaries","Unemployment","Poverty/ Destitution","Rates and taxes","Loans / Credit","Farming/ Agriculture","Food shortage/ Famine","Infrastructure / Roads","Education","Housing","Electricity","Water supply","Services (other)","Health","Sickness / Disease","Crime and security","Corruption","Political instability/ Political divisions/ Ethnic tensions","Discrimination/ Inequality","Gender issues / Women’s rights","Democracy/ Political rights","Climate change","Increasing cost of living","Nothing/ No problems","Communications","Transportation","Land","Political violence","Agricultural marketing","Orphans/ Street children/ Homeless children"],"positive":None},
}

# ---------------------------------------------------------------------------
def main():
    with open(SRC, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    records = []
    q7_map = {"Never": 0, "Just once or twice": 1, "Several times": 2, "Many times": 3, "Always": 4}

    for r in rows:
        region_raw = r["REGION"].strip() if r.get("REGION") else None
        region_name = REGION_TITLE.get(region_raw, region_raw)

        q7_clean = [clean(r.get(f"Q7{L}")) for L in "ABCDE"]
        q7_nums = [q7_map.get(v) for v in q7_clean]
        if all(v is not None for v in q7_nums):
            lpi, lpi_c = lpi_cat(q7_nums)
        else:
            lpi, lpi_c = None, None

        weight_raw = r.get("withinwt_hh") or r.get("withinwt_ea") or "1"
        try:
            weight = float(weight_raw)
        except (ValueError, TypeError):
            weight = 1.0

        rec = {
            "id": r.get("RESPNO"),
            "region": region_name,
            "urbrur": clean(r.get("URBRUR")),
            "gender": clean(r.get("Q101")),
            "age": clean(r.get("Q1")),
            "age_group": age_group(clean(r.get("Q1"))),
            "education": edu_group(clean(r.get("Q96"))),
            "employment": employ_group(clean(r.get("Q94A"))),
            "religion": religion_group(clean(r.get("Q97"))),
            "ethnicity": ethnicity_group(clean(r.get("Q83A"))),
            "lpi": lpi,
            "lpi_cat": lpi_c,
            "weight": weight,
            "ind": {}
        }
        for var in INDICATORS:
            rec["ind"][var] = clean(r.get(var))
        records.append(rec)

    n = len(records)
    with open(os.path.join(OUT_DIR, "records.json"), "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "country": "Ghana", "round": 10, "year": 2024,
        "fieldwork_dates": "5–21 August 2024",
        "fieldwork_partner": "Center for Democratic Development (CDD-Ghana)",
        "sample_size": n,
        "margin_of_error": "+/-2 percentage points at 95% confidence",
        "languages": ["Akan", "English", "Ewe", "Ga", "Dagbani", "Dagaari"],
        "regions": sorted(set(REGION_TITLE.values())),
        "citation": "Afrobarometer Data, Ghana, Round 10, 2024, available at http://www.afrobarometer.org.",
        "codebook_source": "AB_R10.Codebook_Ghana_30June25.pdf, Afrobarometer, prepared by Alfred Torsu, June 2025",
    }
    with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    with open(os.path.join(OUT_DIR, "indicators.json"), "w", encoding="utf-8") as f:
        json.dump(INDICATORS, f, indent=2, ensure_ascii=False)

    # ---- Executive KPIs (weighted) --------------------------------------
    def weighted_pct(var, positive_set):
        num, den = 0.0, 0.0
        for r in records:
            v = r["ind"].get(var)
            if v is None: continue
            den += r["weight"]
            if v in positive_set: num += r["weight"]
        return round(100 * num / den, 1) if den else None

    def weighted_mean(getter):
        num, den = 0.0, 0.0
        for r in records:
            v = getter(r)
            if v is None: continue
            num += v * r["weight"]; den += r["weight"]
        return round(num / den, 2) if den else None

    kpis = {
        "sample_size": n,
        "regions_covered": len(set(r["region"] for r in records if r["region"])),
        "econ_condition_positive_pct": weighted_pct("Q4A", {"Fairly good", "Very good"}),
        "personal_living_positive_pct": weighted_pct("Q4B", {"Fairly good", "Very good"}),
        "support_democracy_pct": weighted_pct("Q22", {"STATEMENT 1: Democracy is preferable to any other kind of government."}),
        "satisfied_democracy_pct": weighted_pct("Q33", {"Fairly satisfied", "Very satisfied"}),
        "president_approval_pct": weighted_pct("Q48A", {"Approve", "Strongly approve"}),
        "trust_president_pct": weighted_pct("Q37A", {"Somewhat", "A lot"}),
        "trust_police_pct": weighted_pct("Q37G", {"Somewhat", "A lot"}),
        "corruption_pres_office_high_pct": weighted_pct("Q38A", {"Most of them", "All of them"}),
        "corruption_worsened_pct": weighted_pct("Q39A", {"Increased a lot", "Increased somewhat"}),
        "right_direction_pct": weighted_pct("Q3", {"Going in the right direction"}),
        "electricity_access_pct": weighted_pct("Q93A", {"Yes"}),
        "internet_access_pct": weighted_pct("Q90H", {"Yes (Has Internet access)"}),
        "avg_lived_poverty_index": weighted_mean(lambda r: r["lpi"]),
    }
    # high lived poverty % (separate because it's derived, not a raw indicator)
    num, den = 0.0, 0.0
    for r in records:
        if r["lpi_cat"] is None: continue
        den += r["weight"]
        if r["lpi_cat"] == "High lived poverty": num += r["weight"]
    kpis["high_lived_poverty_pct"] = round(100 * num / den, 1) if den else None

    # Most important problems (top 5, weighted, first response)
    mip = collections.Counter()
    mip_den = 0.0
    for r in records:
        v = r["ind"].get("Q46PT1")
        if v is None: continue
        mip[v] += r["weight"]
        mip_den += r["weight"]
    top_mip = [{"problem": k, "pct": round(100 * v / mip_den, 1)} for k, v in mip.most_common(6)]
    kpis["top_problems"] = top_mip

    with open(os.path.join(OUT_DIR, "executive.json"), "w", encoding="utf-8") as f:
        json.dump(kpis, f, indent=2, ensure_ascii=False)

    print("Wrote", n, "records,", len(INDICATORS), "indicators")
    print(json.dumps(kpis, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
