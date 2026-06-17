"use client";

import { FormEvent, useState } from "react";

type Match = {
  person_id: string;
  name: string;
  city: string;
  county: string;
  state: string;
  age_bucket: string;
  language_preference: string;
  housing_status: string;
  communication_channel: string;
  registration_status: string;
  ballot_status: string;
  civic_topics: string[];
  similarity: number;
};

const suggestions = [
  "who cares about EVs",
  "Spanish speakers who may need vote by mail help",
  "wildfire emergency preparedness",
  "housing assistance in Los Angeles",
];

export function PeopleSearch() {
  const [query, setQuery] = useState("who cares about EVs");
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function search(nextQuery = query) {
    const trimmed = nextQuery.trim();

    if (!trimmed) {
      return;
    }

    setQuery(trimmed);
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 12 }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Search failed");
      }

      setMatches(payload.matches ?? []);
    } catch (searchError) {
      setMatches([]);
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
                Civic people search
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#53606f] sm:text-base">
                Search the CSV by intent, topic, service need, election context,
                location, or outreach preference.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:flex">
              <Metric label="Dataset" value="100 rows" />
              <Metric label="Vector" value="768 dims" />
            </div>
          </div>
        </header>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-lg border border-[#d8dde6] bg-white p-3 shadow-sm sm:flex-row"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-12 flex-1 rounded-md border border-[#cbd3df] bg-white px-4 text-base text-[#15181e] outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
            placeholder="Ask about interests or needs..."
          />
          <button
            type="submit"
            disabled={isLoading}
            className="min-h-12 rounded-md bg-[#2563eb] px-5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#93a4bd]"
          >
            {isLoading ? "Searching" : "Search"}
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void search(suggestion)}
              className="rounded-full border border-[#cbd3df] bg-white px-3 py-2 text-sm text-[#334155] transition hover:border-[#2563eb] hover:text-[#1d4ed8]"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-lg border border-[#f5b8b8] bg-[#fff1f1] px-4 py-3 text-sm text-[#9f1239]">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3">
          {matches.length === 0 && !isLoading ? (
            <div className="rounded-lg border border-dashed border-[#cbd3df] bg-white px-4 py-10 text-center text-sm text-[#53606f]">
              Run a search to see ranked people from Supabase.
            </div>
          ) : null}

          {matches.map((match) => (
            <article
              key={match.person_id}
              className="rounded-lg border border-[#d8dde6] bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[#111827]">
                      {match.name}
                    </h2>
                    <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-xs font-medium text-[#3730a3]">
                      {(match.similarity * 100).toFixed(1)}% match
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#53606f]">
                    {match.city}, {match.county} County, {match.state}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[460px]">
                  <Fact label="Age" value={match.age_bucket} />
                  <Fact label="Language" value={match.language_preference} />
                  <Fact label="Channel" value={match.communication_channel} />
                  <Fact label="Ballot" value={match.ballot_status} />
                </dl>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {match.civic_topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#334155]"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f8fafc] px-3 py-2">
      <dt className="font-mono text-[10px] uppercase text-[#697586]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-[#111827]">
        {value}
      </dd>
    </div>
  );
}
