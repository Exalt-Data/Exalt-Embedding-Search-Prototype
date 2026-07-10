import { generateJson } from "./gemini";
import type { SearchIntent } from "./search-query";

export type RerankableMatch = {
  summary?: string | null;
};

export type RerankedMatch<T> = T & {
  relevance: number | null;
  reason: string | null;
};

type RawRerank = {
  results?: unknown;
};

const maxReasonLength = 200;
const maxSummaryLength = 700;

const rerankSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "relevance", "reason"],
        properties: {
          index: {
            type: "integer",
            minimum: 0,
          },
          relevance: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },
          reason: {
            type: "string",
            description:
              "One short sentence naming the concrete profile attributes that drive the rating.",
          },
        },
      },
    },
  },
};

export async function rerankMatches<T extends RerankableMatch>(
  query: string,
  intent: SearchIntent,
  matches: T[],
): Promise<RerankedMatch<T>[]> {
  const fallback = matches.map((match) => ({
    ...match,
    relevance: null,
    reason: null,
  }));

  if (matches.length < 2) {
    return fallback;
  }

  try {
    const rawRerank = await generateJson<RawRerank>(
      buildRerankPrompt(query, intent, matches),
      rerankSchema,
    );
    const scores = validateRerank(rawRerank, matches.length);

    if (!scores.size) {
      return fallback;
    }

    return fallback
      .map((match, index) => ({
        ...match,
        relevance: scores.get(index)?.relevance ?? null,
        reason: scores.get(index)?.reason ?? null,
      }))
      .sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1));
  } catch (error) {
    console.error("Rerank failed, keeping retrieval order.", error);

    return fallback;
  }
}

function buildRerankPrompt<T extends RerankableMatch>(
  query: string,
  intent: SearchIntent,
  matches: T[],
) {
  const candidates = matches
    .map((match, index) => `${index}. ${compactSummary(match.summary)}`)
    .join("\n");
  const idealProfileLine = intent.idealProfile
    ? `\nIdeal audience member: ${intent.idealProfile}\n`
    : "";

  return `You are ranking people profiles by how relevant each person is to a topic, for audience recommendations.

Topic or request:
${query}
${idealProfileLine}
Candidate profiles:
${candidates}

Rate every candidate exactly once. relevance is 0-100, where 100 means core audience for the topic and 0 means no plausible interest. reason is one short sentence naming the concrete profile attributes that drive the rating, for example "Homeowner with high auto buy interest and environmental donations". Judge only from stated profile attributes, never from names or ethnicity stereotypes.`;
}

function compactSummary(summary: string | null | undefined) {
  return (summary ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxSummaryLength);
}

function validateRerank(rawRerank: RawRerank, candidateCount: number) {
  const results = Array.isArray(rawRerank.results) ? rawRerank.results : [];
  const scores = new Map<number, { relevance: number; reason: string | null }>();

  for (const entry of results) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const index =
      typeof candidate.index === "number" && Number.isInteger(candidate.index)
        ? candidate.index
        : -1;

    if (index < 0 || index >= candidateCount || scores.has(index)) {
      continue;
    }

    if (
      typeof candidate.relevance !== "number" ||
      !Number.isFinite(candidate.relevance)
    ) {
      continue;
    }

    const relevance = Math.min(Math.max(Math.round(candidate.relevance), 0), 100);
    const reason =
      typeof candidate.reason === "string" && candidate.reason.trim()
        ? candidate.reason.trim().slice(0, maxReasonLength)
        : null;

    scores.set(index, { relevance, reason });
  }

  return scores;
}
