"use client";

import { FormEvent, useState } from "react";

type DatasetKey = "customer_visible" | "voters";

type Match = {
  id: string;
  dataset: DatasetKey;
  source_id: string;
  full_name: string;
  city: string | null;
  county: string | null;
  state: string | null;
  age: string | null;
  age_group: string | null;
  party: string | null;
  ethnicity: string | null;
  language: string | null;
  religion: string | null;
  education: string | null;
  occupation: string | null;
  household: string | null;
  income: string | null;
  net_worth: string | null;
  home_value: string | null;
  property_type: string | null;
  voter_engagement: string | null;
  political_donor_type: string | null;
  tags: string[];
  summary: string;
  similarity: number | null;
};

type SearchIntent = {
  semanticQuery: string;
  filters: {
    field: "language" | "party" | "ethnicity";
    operator: "includes" | "excludes";
    value: string;
  }[];
  summary: string | null;
};

const datasets: { key: DatasetKey; label: string; count: string }[] = [
  { key: "customer_visible", label: "Random", count: "1,000 rows" },
  { key: "voters", label: "Pennsylvania", count: "1,000 rows" },
];

export function PeopleSearch() {
  const [dataset, setDataset] = useState<DatasetKey>("customer_visible");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function search(nextQuery = query, nextDataset = dataset) {
    const trimmed = nextQuery.trim();

    if (!trimmed) {
      return;
    }

    setQuery(trimmed);
    setDataset(nextDataset);
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, dataset: nextDataset, limit: 12 }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Search failed");
      }

      setMatches(payload.matches ?? []);
      setIntent(payload.intent ?? null);
    } catch (searchError) {
      setMatches([]);
      setIntent(null);
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Search failed. Check the server logs.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  const selectedDataset = datasets.find((item) => item.key === dataset);
  const semanticIntent =
    intent?.semanticQuery && intent.semanticQuery !== "people profiles"
      ? intent.semanticQuery
      : null;

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-[#15181e]">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-3 border-b border-[#d8dde6] pb-6">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#53606f]">
            Supabase pgvector + Gemini
          </p>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal text-[#111827] sm:text-4xl">
                Profile search
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#53606f] sm:text-base">
                Search either uploaded dataset with a short query, a tweet, or
                pasted article text. Gemini embeds the text and returns the
                closest matching profiles.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:flex">
              <Metric label="Selected" value={selectedDataset?.count ?? ""} />
              <Metric label="Vector" value="768 dims" />
            </div>
          </div>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid gap-3 rounded-lg border border-[#d8dde6] bg-white p-3 shadow-sm lg:grid-cols-[240px_1fr]"
        >
          <label className="grid gap-1 text-sm">
            <span className="font-mono text-[11px] font-semibold uppercase text-[#697586]">
              Dataset
            </span>
            <select
              value={dataset}
              onChange={(event) => {
                const nextDataset = event.target.value as DatasetKey;
                setDataset(nextDataset);
                setMatches([]);
              }}
              className="min-h-12 rounded-md border border-[#cbd3df] bg-white px-3 text-base text-[#15181e] outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
            >
              {datasets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm lg:row-span-2">
            <span className="font-mono text-[11px] font-semibold uppercase text-[#697586]">
              Query, tweet, or article
            </span>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-32 resize-y rounded-md border border-[#cbd3df] bg-white px-4 py-3 text-base leading-6 text-[#15181e] outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
              placeholder="Paste a tweet, article excerpt, newsletter, policy memo, or type a short audience query..."
            />
          </label>

          <button
            type="submit"
            disabled={isLoading}
            className="min-h-12 rounded-md bg-[#2563eb] px-5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#93a4bd] lg:self-end"
          >
            {isLoading ? "Searching" : "Search"}
          </button>
        </form>

        {error ? (
          <div className="rounded-lg border border-[#f5b8b8] bg-[#fff1f1] px-4 py-3 text-sm text-[#9f1239]">
            {error}
          </div>
        ) : null}

        {intent?.summary || semanticIntent ? (
          <div className="grid gap-1 rounded-lg border border-[#bae6fd] bg-[#eff6ff] px-4 py-3 text-sm text-[#1e3a8a]">
            {intent?.summary ? <div>Applied filters: {intent.summary}</div> : null}
            {semanticIntent ? <div>Semantic match: {semanticIntent}</div> : null}
          </div>
        ) : null}

        <section className="grid gap-3">
          {matches.length === 0 && !isLoading ? (
            <div className="rounded-lg border border-dashed border-[#cbd3df] bg-white px-4 py-10 text-center text-sm text-[#53606f]">
              Pick a dataset and run a search to see ranked profiles from
              Supabase.
            </div>
          ) : null}

          {matches.map((match) => (
            <article
              key={match.id}
              className="rounded-lg border border-[#d8dde6] bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[#111827]">
                      {match.full_name}
                    </h2>
                    <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-xs font-medium text-[#3730a3]">
                      {match.similarity === null
                        ? "Filtered"
                        : `${(match.similarity * 100).toFixed(1)}% match`}
                    </span>
                    <span className="rounded-full bg-[#ecfdf3] px-2.5 py-1 text-xs font-medium text-[#027a48]">
                      {datasetLabel(match.dataset)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#53606f]">
                    {[match.city, match.county && `${match.county} County`, match.state]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[520px]">
                  <Fact label="Age" value={match.age_group || match.age} />
                  <Fact label="Party" value={match.party} />
                  <Fact label="Language" value={match.language} />
                  <Fact label="Income" value={match.income} />
                  <Fact label="Ethnicity" value={match.ethnicity} />
                  <Fact label="Household" value={match.household} />
                  <Fact label="Property" value={match.property_type} />
                  <Fact label="Donor" value={match.political_donor_type} />
                </dl>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {match.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#334155]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#53606f]">
                {match.summary}
              </p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function datasetLabel(dataset: DatasetKey) {
  return datasets.find((item) => item.key === dataset)?.label ?? dataset;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#d8dde6] bg-white px-3 py-2">
      <div className="font-mono text-[11px] uppercase text-[#697586]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[#111827]">{value}</div>
    </div>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-md bg-[#f8fafc] px-3 py-2">
      <dt className="font-mono text-[10px] uppercase text-[#697586]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-[#111827]">
        {value || "—"}
      </dd>
    </div>
  );
}
