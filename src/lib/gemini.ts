import { GoogleGenAI } from "@google/genai";

import { getRequiredEnv } from "./env";

const EMBEDDING_MODEL = "gemini-embedding-2";
const INTENT_MODEL = "gemini-3.5-flash";
export const EMBEDDING_DIMENSIONS = 768;

let gemini: GoogleGenAI | null = null;

function getGemini() {
  if (!gemini) {
    gemini = new GoogleGenAI({ apiKey: getRequiredEnv("GEMINI_API_KEY") });
  }

  return gemini;
}

export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
) {
  const result = await getGemini().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });

  const values = result.embeddings?.[0]?.values;

  if (!values?.length) {
    throw new Error("Gemini did not return an embedding vector.");
  }

  return values;
}

export async function generateJson<T>(contents: string, responseJsonSchema: unknown) {
  const result = await getGemini().models.generateContent({
    model: INTENT_MODEL,
    contents,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema,
    },
  });

  if (!result.text) {
    throw new Error("Gemini did not return a JSON response.");
  }

  return JSON.parse(result.text) as T;
}
