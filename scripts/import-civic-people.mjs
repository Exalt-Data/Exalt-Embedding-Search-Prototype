import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";

const csvPath = resolve(
  process.argv[2] ?? "/Users/vidyadharthatte/Downloads/synthetic_civic_people_100.csv",
);
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

const csv = await readFile(csvPath, "utf8");
const rows = parse(csv, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

console.log(`Importing ${rows.length} people from ${csvPath}`);

for (const [index, row] of rows.entries()) {
  const embeddingText = buildEmbeddingText(row);
  const embedding = await embed(embeddingText);
  const record = {
    person_id: row.person_id,
    name: row.name,
    county: row.county,
    city: row.city,
    state: row.state,
    age_bucket: row.age_bucket,
    language_preference: row.language_preference,
    housing_status: row.housing_status,
    communication_channel: row.communication_channel,
    communication_consent: parseBoolean(row.communication_consent),
    confidential_record: parseBoolean(row.confidential_record),
    registration_status: row.registration_status,
    ballot_status: row.ballot_status,
    civic_topics: splitTopics(row.civic_topics),
    election_admin_text_for_embedding: row.election_admin_text_for_embedding,
    benefits_text_for_embedding: row.benefits_text_for_embedding,
    emergency_text_for_embedding: row.emergency_text_for_embedding,
    embedding_text: embeddingText,
    embedding,
  };

  const { error } = await supabase
    .from("civic_people")
    .upsert(record, { onConflict: "person_id" });

  if (error) {
    throw new Error(`Failed to upsert ${row.person_id}: ${error.message}`);
  }

  console.log(`${index + 1}/${rows.length} ${row.person_id} ${row.name}`);
}

console.log("Import complete.");

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildEmbeddingText(row) {
  return [
    `${row.name} in ${row.city}, ${row.county} County, ${row.state}.`,
    `Civic topics: ${row.civic_topics}.`,
    row.election_admin_text_for_embedding,
    row.benefits_text_for_embedding,
    row.emergency_text_for_embedding,
  ].join("\n");
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

function parseBoolean(value) {
  return String(value).toLowerCase() === "true";
}

function splitTopics(value) {
  return String(value)
    .split(";")
    .map((topic) => topic.trim())
    .filter(Boolean);
}
