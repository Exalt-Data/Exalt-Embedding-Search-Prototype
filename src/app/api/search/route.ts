import { NextResponse } from "next/server";

import { embedText } from "@/lib/gemini";
import {
  matchesSearchIntent,
  parseSearchQuery,
  valuesForFilter,
} from "@/lib/search-query";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const datasets = new Set(["customer_visible", "voters"]);
const directFallbackLimit = 1000;
const searchProfileColumns = `
  id,
  dataset,
  source_id,
  full_name,
  city,
  county,
  state,
  age,
  age_group,
  party,
  ethnicity,
  language,
  religion,
  education,
  occupation,
  household,
  income,
  net_worth,
  home_value,
  property_type,
  voter_engagement,
  political_donor_type,
  tags,
  summary
`;

type SearchMatch = {
  language: string | null;
  party: string | null;
  ethnicity: string | null;
  similarity?: number | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: unknown;
      dataset?: unknown;
      limit?: unknown;
    };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const dataset =
      typeof body.dataset === "string" && datasets.has(body.dataset)
        ? body.dataset
        : "customer_visible";
    const limit = Math.min(
      Math.max(typeof body.limit === "number" ? body.limit : 12, 1),
      25,
    );

    if (!query) {
      return NextResponse.json({ error: "Query is required." }, { status: 400 });
    }

    const intent = await parseSearchQuery(query);
    const queryEmbedding = await embedText(intent.semanticQuery, "RETRIEVAL_QUERY");
    const rpcLimit = intent.filters.length ? Math.min(limit * 4, 50) : limit;
    const includedLanguages = valuesForFilter(intent, "language", "includes");
    const excludedLanguages = valuesForFilter(intent, "language", "excludes");
    const includedParties = valuesForFilter(intent, "party", "includes");
    const excludedParties = valuesForFilter(intent, "party", "excludes");
    const includedEthnicities = valuesForFilter(intent, "ethnicity", "includes");
    const excludedEthnicities = valuesForFilter(intent, "ethnicity", "excludes");
    const supabase = getSupabaseAdmin();
    let usedOutdatedFunctionFallback = false;
    let { data, error } = await supabase.rpc("match_search_profiles", {
      query_embedding: queryEmbedding,
      dataset_filter: dataset,
      match_count: rpcLimit,
      match_threshold: 0,
      included_languages: includedLanguages,
      excluded_languages: excludedLanguages,
      included_parties: includedParties,
      excluded_parties: excludedParties,
      included_ethnicities: includedEthnicities,
      excluded_ethnicities: excludedEthnicities,
    });

    if (error && isOutdatedMatchFunctionError(error)) {
      usedOutdatedFunctionFallback = true;
      const fallback = await supabase.rpc("match_search_profiles", {
        query_embedding: queryEmbedding,
        dataset_filter: dataset,
        match_count: rpcLimit,
        match_threshold: 0,
      });

      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      throw error;
    }

    const matches = ((data ?? []) as SearchMatch[])
      .filter((match) => matchesSearchIntent(match, intent))
      .slice(0, limit);
    const directMatches =
      usedOutdatedFunctionFallback &&
      intent.filters.length &&
      intent.semanticQuery === "people profiles" &&
      matches.length < limit
        ? await runDirectFilterFallback(dataset, intent, limit)
        : [];

    return NextResponse.json({
      matches: directMatches.length > matches.length ? directMatches : matches,
      intent,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run semantic search.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runDirectFilterFallback(
  dataset: string,
  intent: Awaited<ReturnType<typeof parseSearchQuery>>,
  limit: number,
) {
  const { data, error } = await getSupabaseAdmin()
    .from("search_profiles")
    .select(searchProfileColumns)
    .eq("dataset", dataset)
    .limit(directFallbackLimit);

  if (error) {
    throw error;
  }

  return ((data ?? []) as SearchMatch[])
    .filter((match) => matchesSearchIntent(match, intent))
    .slice(0, limit)
    .map((match) => ({ ...match, similarity: null }));
}

function isOutdatedMatchFunctionError(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST202" ||
    /included_languages|excluded_languages|included_parties|excluded_parties|included_ethnicities|excluded_ethnicities|schema cache/i.test(
      error.message ?? "",
    )
  );
}
