import { NextResponse } from "next/server";

import { embedText } from "@/lib/gemini";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: unknown;
      limit?: unknown;
    };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const limit = Math.min(
      Math.max(typeof body.limit === "number" ? body.limit : 12, 1),
      25,
    );

    if (!query) {
      return NextResponse.json({ error: "Query is required." }, { status: 400 });
    }

    const queryEmbedding = await embedText(query, "RETRIEVAL_QUERY");
    const { data, error } = await getSupabaseAdmin().rpc("match_civic_people", {
      query_embedding: queryEmbedding,
      match_count: limit,
      match_threshold: 0,
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({ matches: data ?? [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run semantic search.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
