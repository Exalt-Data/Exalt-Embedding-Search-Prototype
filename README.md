# Civic People Search

Next.js app for semantic search over the civic people CSV using Gemini
embeddings stored in Supabase pgvector.

## Environment

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Set:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key, server-side only
- `GEMINI_API_KEY`: Gemini API key

Add the same variables in Vercel Project Settings before deploying.

## Supabase Setup

Run the SQL in:

```text
supabase/migrations/20260617213500_create_civic_people_vectors.sql
```

It creates:

- `public.civic_people`
- pgvector `embedding vector(768)`
- HNSW cosine index
- `match_civic_people(...)` RPC for ranked semantic search

RLS is enabled. The app uses the service role key from server-only code, so no
public table policy is required for this prototype.

Search results are filtered to records with `communication_consent = true` and
`confidential_record = false`.

## Import The CSV

After the Supabase schema exists and `.env.local` is set:

```bash
npm run import:people
```

The script defaults to:

```text
/Users/vidyadharthatte/Downloads/synthetic_civic_people_100.csv
```

You can pass a different CSV path:

```bash
npm run import:people -- /path/to/people.csv
```

Each row is embedded with `gemini-embedding-2` using
`RETRIEVAL_DOCUMENT` and `outputDimensionality: 768`.

## Local Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run lint
npm run build
```
