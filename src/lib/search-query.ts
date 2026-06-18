import { generateJson } from "./gemini";

export type SearchField = "language" | "party" | "ethnicity";

export type SearchFieldFilter = {
  field: SearchField;
  operator: "includes" | "excludes";
  value: string;
};

export type SearchIntent = {
  semanticQuery: string;
  filters: SearchFieldFilter[];
  summary: string | null;
};

export type SearchProfileFields = {
  language: string | null;
  party: string | null;
  ethnicity: string | null;
};

type RawSearchIntent = {
  semanticQuery?: unknown;
  filters?: unknown;
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

const intentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["semanticQuery", "filters"],
  properties: {
    semanticQuery: {
      type: "string",
      description:
        "The remaining semantic text after removing exact structured filters. Use people profiles when nothing semantic remains.",
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
  },
};

export async function parseSearchQuery(query: string): Promise<SearchIntent> {
  try {
    const rawIntent = await generateJson<RawSearchIntent>(
      buildIntentPrompt(query),
      intentSchema,
    );

    return validateIntent(query, rawIntent);
  } catch {
    return {
      semanticQuery: query,
      filters: [],
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
  return `Convert the user search query into structured filters for a people-search database.

Supported structured fields and canonical values:
- language: ${allowedValues.language.join(", ")}
- party: ${allowedValues.party.join(", ")}
- ethnicity: ${allowedValues.ethnicity.join(", ")}

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

Examples:
Query: people who don't speak Marathi
JSON: {"semanticQuery":"people profiles","filters":[{"field":"language","operator":"excludes","value":"Marathi"}]}

Query: Indians that vote Republican
JSON: {"semanticQuery":"people profiles","filters":[{"field":"ethnicity","operator":"includes","value":"Indian"},{"field":"party","operator":"includes","value":"Republican"}]}

Query: Indians that don't vote Republican
JSON: {"semanticQuery":"people profiles","filters":[{"field":"ethnicity","operator":"includes","value":"Indian"},{"field":"party","operator":"excludes","value":"Republican"}]}

Query: Republicans who hate Trump
JSON: {"semanticQuery":"hate Trump","filters":[{"field":"party","operator":"includes","value":"Republican"}]}

Query: ${query}`;
}

function validateIntent(originalQuery: string, rawIntent: RawSearchIntent): SearchIntent {
  const rawFilters = Array.isArray(rawIntent.filters) ? rawIntent.filters : [];
  const filters = dedupeFilters(rawFilters.flatMap(validateFilter));
  const semanticQuery =
    typeof rawIntent.semanticQuery === "string" && rawIntent.semanticQuery.trim()
      ? cleanSemanticQuery(rawIntent.semanticQuery)
      : originalQuery;

  const filterSummaries = filters.map((filter) => {
    const verb = filter.operator === "includes" ? "includes" : "excludes";

    return `${filter.field} ${verb} ${filter.value}`;
  });

  return {
    semanticQuery,
    filters,
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
