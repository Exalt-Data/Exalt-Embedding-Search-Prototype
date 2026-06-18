import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";

const datasets = [
  {
    key: "customer_visible",
    label: "Customer Visible",
    path: "/Users/vidyadharthatte/Downloads/sample_1000_customer_visible.csv",
  },
  {
    key: "voters",
    label: "Voters",
    path: "/Users/vidyadharthatte/Downloads/sample_1000_voters.csv",
  },
];
const requestedDataset = process.argv[2];
const selectedDatasets = requestedDataset
  ? datasets.filter((dataset) => dataset.key === requestedDataset)
  : datasets;

if (requestedDataset && selectedDatasets.length === 0) {
  throw new Error(
    `Unknown dataset "${requestedDataset}". Use one of: ${datasets
      .map((dataset) => dataset.key)
      .join(", ")}`,
  );
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = requireEnv("GEMINI_API_KEY");
const embeddingModel = "gemini-embedding-2";
const embeddingDimensions = 768;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
const gemini = new GoogleGenAI({ apiKey: geminiApiKey });

for (const dataset of selectedDatasets) {
  await importDataset(dataset);
}

console.log("Import complete.");

async function importDataset(dataset) {
  const csvPath = resolve(dataset.path);
  const csv = await readFile(csvPath, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  console.log(`Replacing ${dataset.label} profiles from ${csvPath}`);

  const deleteResult = await supabase
    .from("search_profiles")
    .delete()
    .eq("dataset", dataset.key);

  if (deleteResult.error) {
    throw new Error(
      `Failed to clear ${dataset.key}: ${deleteResult.error.message}`,
    );
  }

  for (const [index, row] of rows.entries()) {
    const profile = buildProfile(dataset, row);
    const embedding = await embed(profile.summary);
    const record = {
      ...profile,
      embedding,
    };

    const { error } = await supabase
      .from("search_profiles")
      .upsert(record, { onConflict: "id" });

    if (error) {
      throw new Error(`Failed to upsert ${profile.id}: ${error.message}`);
    }

    console.log(
      `${dataset.key} ${index + 1}/${rows.length} ${profile.source_id} ${profile.full_name}`,
    );
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildProfile(dataset, row) {
  const sourceId = clean(row.LALVOTERID) || clean(row.SEQUENCE);
  const fullName =
    clean(row.CONTACT_Full_Name) ||
    [row.Voters_FirstName, row.Voters_MiddleName, row.Voters_LastName]
      .map(clean)
      .filter(Boolean)
      .join(" ") ||
    sourceId;
  const tags = buildTags(row);
  const summary = buildSummary(dataset, row, fullName, tags);

  return {
    id: `${dataset.key}:${sourceId}`,
    dataset: dataset.key,
    source_id: sourceId,
    full_name: fullName,
    city: clean(row.ADDR_Residence_City) || clean(row.City),
    county: clean(row.County),
    state: clean(row.ADDR_Residence_State) || clean(row.DIST_Source_State),
    age: clean(row.DEMO_Age),
    age_group: clean(row.FEAT_DEMO_Age_Group),
    party: clean(row.POL_Party),
    ethnicity: clean(row.DEMO_Ethnicity_Desc),
    language: clean(row.DEMO_Language) || clean(row.DEMO_Language_Code),
    religion: clean(row.DEMO_Religion),
    education: clean(row.DEMO_Education),
    occupation:
      clean(row.ConsumerData_LikelyRecentEmployment_Standardized_Title) ||
      clean(row.ConsumerData_Occupation_of_Person) ||
      clean(row.DEMO_Occupation_Group),
    household: clean(row.FEAT_DEMO_HH_Lifestage),
    income: clean(row.FIN_Income_Estimated),
    net_worth: clean(row.FIN_NetWorth_Band),
    home_value:
      clean(row.ConsumerData_Home_Est_Current_Value_Code) ||
      clean(row.FIN_HomeValue_Numeric),
    property_type:
      clean(row.HOUSING_Property_Type) || clean(row.HOUSING_Dwelling_Type),
    voter_engagement: clean(row.POL_Engagement_Score),
    political_donor_type: clean(row.FEAT_DONOR_Political_Type),
    tags,
    summary,
    raw_profile: pickRawProfile(row),
  };
}

function buildSummary(dataset, row, fullName, tags) {
  return [
    `Dataset: ${dataset.label}.`,
    `Person: ${fullName}.`,
    `Location: ${clean(row.ADDR_Residence_City) || clean(row.City)}, ${clean(row.County)} County, ${clean(row.ADDR_Residence_State) || clean(row.DIST_Source_State)}.`,
    `Demographics: age ${clean(row.DEMO_Age)}, age group ${clean(row.FEAT_DEMO_Age_Group)}, gender ${clean(row.DEMO_Gender)}, ethnicity ${clean(row.DEMO_Ethnicity_Desc)}, language ${clean(row.DEMO_Language)}, religion ${clean(row.DEMO_Religion)}, education ${clean(row.DEMO_Education)}.`,
    `Political profile: party ${clean(row.POL_Party)}, engagement score ${clean(row.POL_Engagement_Score)}, turnout rate ${clean(row.FEAT_Turnout_Rate_Even_Year_General)}, primary voter propensity ${clean(row.FEAT_Primary_Voter_Propensity)}, donor type ${clean(row.FEAT_DONOR_Political_Type)}, ideology score ${clean(row.FEAT_DONOR_Ideology_Score)}.`,
    `Household and finance: ${clean(row.FEAT_DEMO_HH_Lifestage)}, household size ${clean(row.FEAT_DEMO_HH_Size_Category)}, income ${clean(row.FIN_Income_Estimated)}, income band ${clean(row.FEAT_DEMO_Household_Income_Band)}, net worth ${clean(row.FIN_NetWorth_Band)}, homeowner ${clean(row.FIN_Is_Homeowner)}, property ${clean(row.HOUSING_Property_Type)}, home value ${clean(row.FIN_HomeValue_Numeric)}.`,
    `Interests and lifestyle: tech score ${clean(row.FEAT_LIFE_Tech_Savviness_Score)}, outdoors score ${clean(row.FEAT_LIFE_Outdoor_Sports_Score)}, health score ${clean(row.FEAT_LIFE_Health_Wellness_Score)}, home garden score ${clean(row.FEAT_LIFE_Home_Garden_Score)}, financial acumen score ${clean(row.FEAT_LIFE_Financial_Acumen_Score)}, travel score ${clean(row.FEAT_LIFE_Traveler_Score)}, auto interest ${clean(row.ConsumerData_Auto_Buy_Interest)}, vehicle ${clean(row.ConsumerData_Auto_Make_1)} ${clean(row.ConsumerData_Auto_Model_1)} ${clean(row.ConsumerData_Auto_Year_1)}.`,
    `Charitable profile: environmental ${clean(row.FEAT_CHAR_Environmental_Supporter_Flag)}, animal welfare ${clean(row.FEAT_CHAR_Animal_Welfare_Supporter_Flag)}, veterans ${clean(row.FEAT_CHAR_Veterans_Supporter_Flag)}, arts cultural ${clean(row.FEAT_CHAR_Arts_Cultural_Supporter_Flag)}, community charity ${clean(row.FEAT_CHAR_Community_Charity_Focus_Flag)}.`,
    `Diaspora and community profile: STEM professional ${clean(row.FEAT_DIASPORA_STEM_Professional)}, medical professional ${clean(row.FEAT_DIASPORA_Medical_Professional)}, entrepreneur ${clean(row.FEAT_DIASPORA_Entrepreneur)}, cultural heritage score ${clean(row.FEAT_DIASPORA_Cultural_Heritage_Score)}, community leadership score ${clean(row.FEAT_DIASPORA_Community_Leadership_Score)}.`,
    `Tags: ${tags.join(", ")}.`,
  ]
    .filter((line) => !line.includes("undefined"))
    .join("\n");
}

function buildTags(row) {
  const tags = [];
  addTag(tags, row.FEAT_DEMO_Age_Group);
  addTag(tags, row.POL_Party);
  addTag(tags, row.FEAT_DEMO_HH_Lifestage);
  addTag(tags, row.FEAT_DEMO_Household_Income_Band);
  addTag(tags, row.FEAT_FIN_Credit_Card_Tier);
  addTag(tags, row.FEAT_GEO_Urbanicity);
  addFlagTag(tags, row.FIN_Is_Homeowner, "homeowner");
  addFlagTag(tags, row.Invests, "investor");
  addFlagTag(tags, row.Has_Premium_CC, "premium credit");
  addFlagTag(tags, row.Is_Interested_In_Politics, "politics interest");
  addFlagTag(tags, row.Is_Business_Owner_Flag, "business owner");
  addFlagTag(tags, row.Is_High_Tech_Leader, "high tech leader");
  addFlagTag(tags, row.FEAT_CHAR_Environmental_Supporter_Flag, "environmental supporter");
  addFlagTag(tags, row.FEAT_CHAR_Animal_Welfare_Supporter_Flag, "animal welfare supporter");
  addFlagTag(tags, row.FEAT_CHAR_Veterans_Supporter_Flag, "veterans supporter");
  addFlagTag(tags, row.FEAT_DIASPORA_STEM_Professional, "STEM professional");
  addFlagTag(tags, row.FEAT_DIASPORA_Entrepreneur, "entrepreneur");
  addFlagTag(tags, row.FEAT_DIASPORA_Medical_Professional, "medical professional");
  addScoreTag(tags, row.FEAT_LIFE_Tech_Savviness_Score, "tech savvy");
  addScoreTag(tags, row.FEAT_LIFE_Outdoor_Sports_Score, "outdoor sports");
  addScoreTag(tags, row.FEAT_LIFE_Health_Wellness_Score, "health wellness");
  addScoreTag(tags, row.FEAT_LIFE_Home_Garden_Score, "home garden");
  addScoreTag(tags, row.FEAT_LIFE_Traveler_Score, "traveler");

  return [...new Set(tags)].slice(0, 18);
}

function addTag(tags, value) {
  const cleaned = clean(value);
  if (cleaned) tags.push(cleaned);
}

function addFlagTag(tags, value, tag) {
  if (isAffirmative(value)) tags.push(tag);
}

function addScoreTag(tags, value, tag) {
  const numeric = Number.parseFloat(clean(value));
  if (Number.isFinite(numeric) && numeric >= 1) tags.push(tag);
}

function pickRawProfile(row) {
  const keys = [
    "LALVOTERID",
    "CONTACT_Full_Name",
    "ADDR_Residence_City",
    "ADDR_Residence_State",
    "County",
    "DEMO_Age",
    "FEAT_DEMO_Age_Group",
    "POL_Party",
    "DEMO_Ethnicity_Desc",
    "DEMO_Language",
    "DEMO_Religion",
    "FIN_Income_Estimated",
    "FIN_NetWorth_Band",
    "FIN_HomeValue_Numeric",
    "HOUSING_Property_Type",
    "FEAT_DONOR_Political_Type",
    "FEAT_LIFE_Tech_Savviness_Score",
    "FEAT_CHAR_Environmental_Supporter_Flag",
    "ConsumerData_Auto_Buy_Interest",
    "ConsumerData_Auto_Make_1",
    "ConsumerData_Auto_Model_1",
  ];

  return Object.fromEntries(keys.map((key) => [key, clean(row[key])]));
}

async function embed(text) {
  const result = await gemini.models.embedContent({
    model: embeddingModel,
    contents: text,
    config: {
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: embeddingDimensions,
    },
  });
  const values = result.embeddings?.[0]?.values;

  if (!values?.length) {
    throw new Error("Gemini did not return an embedding vector.");
  }

  return values;
}

function clean(value) {
  return String(value ?? "").trim();
}

function isAffirmative(value) {
  return ["y", "yes", "true", "1"].includes(clean(value).toLowerCase());
}
