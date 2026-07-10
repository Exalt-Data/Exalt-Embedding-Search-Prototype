# Exalt Embeddings Recommendation Prototype

Live demo: [https://exaltprototype.vercel.app/](https://exaltprototype.vercel.app/)

This repo is a working recommendation prototype for how Exalt could adopt
embedding-based retrieval for people search and people recommendations. It is a
smaller version of the recommendation system Exalt could build over all Exalt
people profiles: turn each person profile into an embedding, embed the user's
query or source text, and return the closest matching people.

The prototype uses two 1,000-row sample profile datasets:

- **Random**: `sample_1000_customer_visible.csv`
- **Pennsylvania**: `sample_1000_voters.csv`

These sample datasets stand in for the full set of people Exalt would
eventually recommend from.

This prototype uses Gemini's
[`gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings)
embedding model to convert profile text and user queries into numeric vectors.
Ranking happens in
[Supabase Postgres with pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
similarity search.

Search queries are also interpreted by Gemini `gemini-3.1-flash` before
retrieval. The app converts natural-language requests into validated structured
filters plus a semantic query, so negated or compound searches such as
`people who do not speak Marathi`, `Indians that vote Republican`, and
`democrats who like EVs` do not rely on embeddings alone.

For topical searches (a tweet, article, or policy story), the same parsing step
also produces a hypothetical ideal profile that is embedded in place of the raw
topic text, plus weighted audience affinity signals drawn from the profile tag
vocabulary. Retrieved candidates are re-ranked by vector similarity plus how
many affinity signals their tags match, so matching is driven by who would care
about the topic rather than surface word overlap. A final LLM rerank then
scores the shortlist for topic relevance and explains each match in one
sentence.

## How a Search Works

Every search runs the same six-step pipeline. Here is what happens when you
paste a news headline like
`New federal tax credit announced for home EV chargers`:

1. **Parse intent.** Gemini `gemini-3.1-flash` reads the text and produces a
   structured interpretation:

   ```json
   {
     "semanticQuery": "interested in electric vehicles, home chargers, and energy tax credits",
     "idealProfile": "A suburban homeowner who is tech savvy, interested in new vehicles and home improvement, supports environmental causes, and pays attention to tax policy.",
     "filters": [],
     "signals": [
       { "tag": "homeowner", "weight": 3 },
       { "tag": "environmental supporter", "weight": 2 },
       { "tag": "tech savvy", "weight": 2 },
       { "tag": "home garden", "weight": 1 }
     ]
   }
   ```

   A query like `Indians that do not vote Republican` instead produces hard
   filters (`ethnicity includes Indian; party excludes Republican`) and no
   topical signals.

2. **Validate.** The app checks every filter field, operator, value, and
   signal tag against a fixed allowlist. Anything the LLM invents outside that
   vocabulary is dropped, so nothing unvalidated ever reaches the database.

3. **Embed the ideal profile, not the topic.** The stored vectors are
   embeddings of profile summaries, so the app embeds the profile-shaped
   `idealProfile` text (a HyDE-style query expansion) rather than the raw
   headline. Profile-to-profile comparison lands much closer in vector space
   than headline-to-profile comparison.

4. **Retrieve.** Supabase applies the hard filters and returns the candidates
   whose profile vectors are closest to the query vector by cosine similarity,
   pulling a wider pool (up to 50) when filters or signals are in play.

5. **Re-rank by affinity.** Each candidate's tags are checked against the
   weighted signals. A profile matching all signals gets a boost of up to
   +0.15 on top of its similarity score, so a true core-audience member
   outranks a profile whose text merely echoes the topic's words.

6. **LLM rerank with reasons.** For topical searches, the top 24 candidates go
   to Gemini `gemini-3.1-flash` in a single call. The model rates each person
   0-100 for audience relevance and writes a one-sentence reason grounded in
   stated profile attributes (for example, "Homeowner with very high auto
   interest"). Results are ordered by that relevance score, and the reason is
   shown on each card. Pure filter queries like `Indians that do not vote
   Republican` skip this step, since there is no topic to judge against. If
   the rerank call fails, the app falls back to the step 5 ordering.

### Reading the Results

- The **blue banner** above the results shows exactly how the query was
  interpreted: applied filters, the semantic remainder, the audience signals,
  and the ideal profile being matched against. If a search returns something
  unexpected, this banner shows why.
- The **purple badge** on each card is raw cosine similarity between the query
  vector and that person's profile vector.
- The **amber badge** (for example `3/4 signals`) shows how many of the
  topic's audience signals that person carries, and the matching tags are
  highlighted in amber in the tag list.
- The **sky-blue badge** (for example `90% relevant`) is the LLM reranker's
  relevance rating for the topic, and the italic line under the profile facts
  is its one-sentence explanation of why this person matches.
- For topical searches, results are ordered by the reranker's relevance score;
  for filter-only searches, by similarity plus weighted affinity.

## Why This Matters For Exalt

People recommendations often need to match intent, context, and related
concepts across many profile fields. Regular search is strongest when the query
and the record use the same terms. Embeddings are better suited for
recommendation-style search because they can represent the meaning of a person
profile, a short query, a trending topic, or a social post in the same vector
space.

That makes it possible to ask for an audience around a concept like a policy
issue, a breaking news story, a tweet, or a newsletter excerpt and return people
whose full profile is semantically relevant, even if the exact words are not
present in a single field.

For this prototype, embeddings make it possible to:

- Represent each person profile across many attributes.
- Embed short queries, pasted tweets, articles, newsletters, policy memos, or
  trending topics.
- Return ranked candidates with similarity scores.
- Prototype a focused people recommendation flow before expanding to the full
  Exalt people dataset.

## Core Implementation Concept

The project turns each source record into a searchable semantic document. In
this prototype, each CSV row describes a person profile. During import, the
script combines demographic, location, household, financial, political,
lifestyle, charitable, diaspora, and tag fields into one text summary for that
person.

Gemini's
[`gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings)
embedding model converts that text block into a 768-dimensional numeric vector.
The vector is stored in
[Supabase Postgres using pgvector](https://supabase.com/docs/guides/database/extensions/pgvector).

When a user searches, the app first asks Gemini `gemini-3.1-flash` to split the
request into:

- Structured filters for fields the database can enforce, currently language,
  party, and ethnicity.
- A remaining semantic query for concepts that are not structured fields.
- A hypothetical ideal profile: one to three sentences describing the person
  most relevant to the topic, written like a stored profile summary.
- Weighted affinity signals: up to six tags from the profile tag vocabulary
  (for example `homeowner`, `environmental supporter`, `tech savvy`) with
  weights 1-3 indicating how strongly each tag predicts interest in the topic.

The app validates the LLM output against an allowlist of supported fields,
operators, values, and signal tags before it reaches Supabase. It then embeds
the ideal profile when one exists (falling back to the semantic query), because
profile-shaped text lands closer to the stored profile embeddings than raw
topic text does. Supabase applies the structured filters and compares the query
vector to stored record vectors using cosine similarity. Finally the app
re-ranks candidates by similarity plus a weighted affinity score from matched
signal tags.

Examples:

```text
people who do not speak Marathi
  -> filters: language excludes Marathi
  -> semantic query: people profiles
  -> signals: none (pure filter query)

Indians that do not vote Republican
  -> filters: ethnicity includes Indian, party excludes Republican
  -> semantic query: people profiles
  -> signals: none (pure filter query)

democrats who like EVs
  -> filters: party includes Democrat
  -> semantic query: like electric vehicles
  -> ideal profile: a tech-savvy driver interested in buying an electric
     vehicle who follows clean energy trends and supports environmental causes
  -> signals: environmental supporter x3, tech savvy x2
```

```text
Exalt person profile or CSV row
        ↓
Build profile summary from meaningful people fields
        ↓
Gemini embedding model: gemini-embedding-2
        ↓
Store vector in Supabase pgvector
        ↓
User query or recommendation context
        ↓
Gemini intent parser: gemini-3.1-flash
        ↓
Validated filters + semantic query + ideal profile + affinity signals
        ↓
Embed ideal profile (or semantic query) with the same model
        ↓
Filtered cosine similarity search
        ↓
Re-rank by similarity + weighted affinity signal matches
        ↓
LLM rerank of top candidates with relevance scores + reasons
        ↓
Ranked recommendation candidates
```

## What This Prototype Demonstrates

- Import structured records from CSV.
- Build a summary representation from fields that influence relevance.
- Generate 768-dimensional vectors with Gemini's
  [`gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings)
  embedding model.
- Store vectors in
  [Supabase Postgres with pgvector](https://supabase.com/docs/guides/database/extensions/pgvector).
- Search using a short query, pasted tweet, article excerpt, newsletter, or
  policy memo.
- Interpret natural-language filters and negation before retrieval.
- Expand topics into a hypothetical ideal profile before embedding
  (HyDE-style query expansion).
- Re-rank candidates by weighted audience affinity signals matched against
  profile tags.
- LLM-rerank the shortlist with per-person relevance scores and one-line
  explanations of why each person matches.
- Return ranked matches with similarity, affinity, and relevance scores.
- Switch between the Random and Pennsylvania datasets from the UI.

## Current Implementation

This prototype has three main pieces:

- A CSV ingestion pipeline that creates embeddings for sample records.
- A pgvector-backed Supabase table and RPC function that rank records by vector
  similarity with deterministic language, party, and ethnicity filters.
- A Gemini intent parser that converts natural-language searches into validated
  structured filters, a semantic query, a hypothetical ideal profile for
  embedding, and weighted audience affinity signals.
- An LLM reranker that scores the retrieved shortlist for topic relevance and
  explains each match in one sentence.
- A Next.js UI and API route that parse, embed, call Supabase, re-rank, and
  render ranked matches with matched signals and match explanations.

## Tech Stack

- [Next.js 16 App Router](https://nextjs.org/docs/app)
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Supabase Postgres with pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Gemini `gemini-embedding-2` embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
  via [`@google/genai`](https://googleapis.github.io/js-genai/)
- Gemini `gemini-3.1-flash` for query intent parsing
- [`csv-parse`](https://csv.js.org/parse/) for CSV import

## Project Structure

```text
src/app/page.tsx                         Main page that renders the search UI
src/components/people-search.tsx         Client-side search form and results
src/app/api/search/route.ts              Server-side semantic search endpoint
src/lib/gemini.ts                        Gemini embedding and JSON helpers
src/lib/search-query.ts                  LLM query intent parser and validator
src/lib/rerank.ts                        LLM shortlist reranker with reasons
src/lib/supabase.ts                      Supabase service-role client
scripts/import-search-profiles.mjs       CSV import and embedding script
supabase/migrations/*.sql                pgvector table, index, and RPC setup
```

## Environment Variables

Create `.env.local` in the project root with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-gemini-api-key
```

`SUPABASE_SERVICE_ROLE_KEY` is used only in server-side code and the import
script. Do not expose it in client-side code.

## Supabase Setup

Run the SQL migrations in:

```text
supabase/migrations/20260618194458_create_search_profiles.sql
supabase/migrations/20260618231706_add_search_profile_language_filters.sql
```

The migrations create:

- The `public.search_profiles` table
- A `vector(768)` embedding column
- An HNSW cosine index for vector search
- A `match_search_profiles(...)` RPC function for ranked semantic search
- Deterministic include/exclude filters for language, party, and ethnicity
- Row-level security on the table

Because this prototype uses the Supabase service role key from server-side code,
no public table policy is required for the app's current search flow.

## Importing People Data

After the database schema exists and `.env.local` is configured, import the CSV:

```bash
npm run import:profiles
```

By default, the script imports both sample datasets:

```text
/Users/vidyadharthatte/Downloads/sample_1000_customer_visible.csv
/Users/vidyadharthatte/Downloads/sample_1000_voters.csv
```

To import only one dataset, pass its dataset key:

```bash
npm run import:profiles -- customer_visible
npm run import:profiles -- voters
```

For each row, the script combines profile fields into a searchable summary. It
then embeds that summary using Gemini's
[`gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings) model
with `RETRIEVAL_DOCUMENT` and stores the vector in Supabase.

## Product Links

- [Live demo](https://exaltprototype.vercel.app/)
- [Gemini embeddings documentation](https://ai.google.dev/gemini-api/docs/embeddings)
- [Google Gen AI JavaScript SDK](https://googleapis.github.io/js-genai/)
- [Supabase pgvector documentation](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Next.js App Router documentation](https://nextjs.org/docs/app)

## Running Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

```bash
npm run dev            # Start the Next.js dev server
npm run build          # Build the app for production
npm run start          # Start the production server
npm run lint           # Run ESLint
npm run import:profiles  # Import and embed profile data
npm run import:people    # Alias for import:profiles
```

## Verification

Run linting and a production build before deploying:

```bash
npm run lint
npm run build
```
