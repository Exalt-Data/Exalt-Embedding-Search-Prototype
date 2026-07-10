import { generateJson } from "./gemini";

export type SearchField = "language" | "party" | "ethnicity";

export type SearchFieldFilter = {
  field: SearchField;
  operator: "includes" | "excludes";
  value: string;
};

export type AffinitySignal = {
  tag: string;
  weight: number;
};

export type SearchIntent = {
  semanticQuery: string;
  idealProfile: string | null;
  filters: SearchFieldFilter[];
  signals: AffinitySignal[];
  summary: string | null;
};

export type SearchProfileFields = {
  language: string | null;
  party: string | null;
  ethnicity: string | null;
};

type RawSearchIntent = {
  semanticQuery?: unknown;
  idealProfile?: unknown;
  filters?: unknown;
  signals?: unknown;
};

const allowedValues: Record<SearchField, string[]> = {
  language: [
    "Bengali",
    "English",
    "Gujarati",
    "Hindi",
    "Kannada",
    "Malayalam",
    "Marathi",
    "Punjabi",
    "Spanish",
    "Tamil",
    "Telugu",
    "Urdu",
  ],
  party: ["Democrat", "Independent", "Republican"],
  ethnicity: ["Indian", "South Asian"],
};

const valueAliases = new Map<string, string>([
  ["asian indian", "Indian"],
  ["asian indians", "Indian"],
  ["democratic", "Democrat"],
  ["democrats", "Democrat"],
  ["dems", "Democrat"],
  ["gop", "Republican"],
  ["indians", "Indian"],
  ["independents", "Independent"],
  ["republicans", "Republican"],
  ["south asians", "South Asian"],
]);

// Must stay in sync with the tag values written by scripts/import-search-profiles.mjs.
export const signalTags = [
  "homeowner",
  "investor",
  "premium credit",
  "politics interest",
  "business owner",
  "high tech leader",
  "environmental supporter",
  "animal welfare supporter",
  "veterans supporter",
  "STEM professional",
  "entrepreneur",
  "medical professional",
  "tech savvy",
  "outdoor sports",
  "health wellness",
  "home garden",
  "traveler",
];

const maxSignals = 6;
const maxIdealProfileLength = 700;

const intentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["semanticQuery", "idealProfile", "filters", "signals"],
  properties: {
    semanticQuery: {
      type: "string",
      description:
        "The remaining semantic text after removing exact structured filters. Use people profiles when nothing semantic remains.",
    },
    idealProfile: {
      type: "string",
      description:
        "One to three sentences describing the hypothetical person most relevant to the topic, written like a profile summary. Empty string when the query only contains structured filters.",
    },
    filters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "operator", "value"],
        properties: {
          field: {
            type: "string",
            enum: ["language", "party", "ethnicity"],
          },
          operator: {
            type: "string",
            enum: ["includes", "excludes"],
          },
          value: {
            type: "string",
          },
        },
      },
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tag", "weight"],
        properties: {
          tag: {
            type: "string",
            enum: signalTags,
          },
          weight: {
            type: "integer",
            minimum: 1,
            maximum: 3,
          },
        },
      },
    },
  },
};

export async function parseSearchQuery(query: string): Promise<SearchIntent> {
  try {
    const rawIntent = await generateJson<RawSearchIntent>(
      buildIntentPrompt(query),
      intentSchema,
    );

    return validateIntent(query, rawIntent);
  } catch (error) {
    console.error("Search intent parsing failed, falling back to raw query.", error);

    return {
      semanticQuery: query,
      idealProfile: null,
      filters: [],
      signals: [],
      summary: null,
    };
  }
}

export function matchesSearchIntent<T extends SearchProfileFields>(
  match: T,
  intent: SearchIntent,
) {
  return intent.filters.every((filter) => {
    const value = match[filter.field]?.toLowerCase() ?? "";
    const contains = value.includes(filter.value.toLowerCase());

    return filter.operator === "includes" ? contains : !contains;
  });
}

export function scoreProfileSignals(
  tags: string[] | null | undefined,
  intent: SearchIntent,
) {
  if (!intent.signals.length) {
    return { affinity: null as number | null, matchedSignals: [] as string[] };
  }

  const profileTags = new Set((tags ?? []).map((tag) => tag.toLowerCase()));
  const matchedSignals: string[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const signal of intent.signals) {
    totalWeight += signal.weight;

    if (profileTags.has(signal.tag.toLowerCase())) {
      matchedSignals.push(signal.tag);
      matchedWeight += signal.weight;
    }
  }

  return {
    affinity: totalWeight ? matchedWeight / totalWeight : null,
    matchedSignals,
  };
}

export function valuesForFilter(
  intent: SearchIntent,
  field: SearchField,
  operator: SearchFieldFilter["operator"],
) {
  return intent.filters
    .filter((filter) => filter.field === field && filter.operator === operator)
    .map((filter) => filter.value);
}

function buildIntentPrompt(query: string) {
  return `Convert the user search query into structured search intent for a people-recommendation database. The query may be a short audience request or pasted long-form text such as a tweet, article, or policy memo.

Supported structured fields and canonical values:
- language: ${allowedValues.language.join(", ")}
- party: ${allowedValues.party.join(", ")}
- ethnicity: ${allowedValues.ethnicity.join(", ")}

Affinity signal tags that exist on profiles:
${signalTags.join(", ")}

Rules:
- Use filters only for supported fields above.
- Convert negation to operator "excludes".
- "vote Republican", "Republican voter", and "Republicans" mean party includes Republican.
- "don't vote Republican", "not Republican", and "non-Republican" mean party excludes Republican.
- "Indians" means ethnicity includes Indian when the query asks for people/voters/profiles.
- "don't speak Marathi" means language excludes Marathi.
- Keep subjective or unsupported claims in semanticQuery. For example, "hate Trump" is not a structured field here.
- Remove connector words like "who" or "that" from the start of semanticQuery.
- Do not infer fields from names, location, stereotypes, or unstated background.
- If only structured filters remain, set semanticQuery to "people profiles".
- signals: pick up to ${maxSignals} affinity tags that indicate a person would care about the topic. Weight 3 means core audience signal, 2 means strong signal, 1 means mild signal. Use [] when the query is only structured filters.
- idealProfile: describe the hypothetical person most relevant to the topic in one to three sentences, written like a profile summary covering interests, lifestyle, household, and politics when relevant. Use "" when the query only contains structured filters or has no topical content.

Examples:
Query: people who don't speak Marathi
JSON: {"semanticQuery":"people profiles","idealProfile":"","filters":[{"field":"language","operator":"excludes","value":"Marathi"}],"signals":[]}

Query: Indians that don't vote Republican
JSON: {"semanticQuery":"people profiles","idealProfile":"","filters":[{"field":"ethnicity","operator":"includes","value":"Indian"},{"field":"party","operator":"excludes","value":"Republican"}],"signals":[]}

Query: Republicans who hate Trump
JSON: {"semanticQuery":"hate Trump","idealProfile":"A politically engaged Republican voter who is critical of Trump and follows political news closely.","filters":[{"field":"party","operator":"includes","value":"Republican"}],"signals":[{"tag":"politics interest","weight":2}]}

Query: democrats who like EVs
JSON: {"semanticQuery":"like electric vehicles","idealProfile":"A tech-savvy driver interested in buying an electric vehicle who follows clean energy and auto trends and supports environmental causes.","filters":[{"field":"party","operator":"includes","value":"Democrat"}],"signals":[{"tag":"tech savvy","weight":2},{"tag":"environmental supporter","weight":3}]}

Query: New federal tax credit announced for home EV chargers
JSON: {"semanticQuery":"interested in electric vehicles, home chargers, and energy tax credits","idealProfile":"A suburban homeowner who is tech savvy, interested in new vehicles and home improvement, supports environmental causes, and pays attention to tax policy.","filters":[],"signals":[{"tag":"homeowner","weight":3},{"tag":"environmental supporter","weight":2},{"tag":"tech savvy","weight":2},{"tag":"home garden","weight":1}]}

Query: ${query}`;
}

function validateIntent(originalQuery: string, rawIntent: RawSearchIntent): SearchIntent {
  const rawFilters = Array.isArray(rawIntent.filters) ? rawIntent.filters : [];
  const filters = dedupeFilters(rawFilters.flatMap(validateFilter));
  const rawSignals = Array.isArray(rawIntent.signals) ? rawIntent.signals : [];
  const signals = dedupeSignals(rawSignals.flatMap(validateSignal)).slice(
    0,
    maxSignals,
  );
  const semanticQuery =
    typeof rawIntent.semanticQuery === "string" && rawIntent.semanticQuery.trim()
      ? cleanSemanticQuery(rawIntent.semanticQuery)
      : originalQuery;
  const idealProfile =
    typeof rawIntent.idealProfile === "string" && rawIntent.idealProfile.trim()
      ? rawIntent.idealProfile.trim().slice(0, maxIdealProfileLength)
      : null;

  const filterSummaries = filters.map((filter) => {
    const verb = filter.operator === "includes" ? "includes" : "excludes";

    return `${filter.field} ${verb} ${filter.value}`;
  });

  return {
    semanticQuery,
    idealProfile,
    filters,
    signals,
    summary: filterSummaries.length ? filterSummaries.join("; ") : null,
  };
}

function validateFilter(value: unknown): SearchFieldFilter[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const field = candidate.field;
  const operator = candidate.operator;
  const rawValue = candidate.value;

  if (
    !isSearchField(field) ||
    (operator !== "includes" && operator !== "excludes") ||
    typeof rawValue !== "string"
  ) {
    return [];
  }

  const canonicalValue = canonicalizeValue(rawValue);

  if (!allowedValues[field].includes(canonicalValue)) {
    return [];
  }

  return [{ field, operator, value: canonicalValue }];
}

function validateSignal(value: unknown): AffinitySignal[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const rawTag =
    typeof candidate.tag === "string" ? candidate.tag.trim().toLowerCase() : "";
  const tag = signalTags.find((signalTag) => signalTag.toLowerCase() === rawTag);

  if (!tag) {
    return [];
  }

  const weight =
    typeof candidate.weight === "number" && Number.isFinite(candidate.weight)
      ? Math.min(Math.max(Math.round(candidate.weight), 1), 3)
      : 1;

  return [{ tag, weight }];
}

function canonicalizeValue(value: string) {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  return valueAliases.get(lower) ?? titleCase(trimmed);
}

function dedupeFilters(filters: SearchFieldFilter[]) {
  const excludes = new Set(
    filters
      .filter((filter) => filter.operator === "excludes")
      .map((filter) => `${filter.field}:${filter.value.toLowerCase()}`),
  );
  const deduped = new Map<string, SearchFieldFilter>();

  for (const filter of filters) {
    if (
      filter.operator === "includes" &&
      excludes.has(`${filter.field}:${filter.value.toLowerCase()}`)
    ) {
      continue;
    }

    deduped.set(
      `${filter.field}:${filter.operator}:${filter.value.toLowerCase()}`,
      filter,
    );
  }

  return Array.from(deduped.values());
}

function dedupeSignals(signals: AffinitySignal[]) {
  const deduped = new Map<string, AffinitySignal>();

  for (const signal of signals) {
    const key = signal.tag.toLowerCase();
    const existing = deduped.get(key);

    if (!existing || existing.weight < signal.weight) {
      deduped.set(key, signal);
    }
  }

  return Array.from(deduped.values());
}

function isSearchField(value: unknown): value is SearchField {
  return value === "language" || value === "party" || value === "ethnicity";
}

function cleanSemanticQuery(value: string) {
  let cleaned = value.trim();
  const lower = cleaned.toLowerCase();

  for (const prefix of ["who ", "that "]) {
    if (lower.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
      break;
    }
  }

  return cleaned || "people profiles";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
