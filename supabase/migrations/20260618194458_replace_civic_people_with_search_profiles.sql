create extension if not exists vector with schema extensions;

drop function if exists public.match_civic_people(vector(768), int, float);
drop table if exists public.civic_people;

create table if not exists public.search_profiles (
  id text primary key,
  dataset text not null check (dataset in ('customer_visible', 'voters')),
  source_id text not null,
  full_name text not null,
  city text,
  county text,
  state text,
  age text,
  age_group text,
  party text,
  ethnicity text,
  language text,
  religion text,
  education text,
  occupation text,
  household text,
  income text,
  net_worth text,
  home_value text,
  property_type text,
  voter_engagement text,
  political_donor_type text,
  tags text[] not null default '{}',
  summary text not null,
  raw_profile jsonb not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.search_profiles enable row level security;

create index if not exists search_profiles_dataset_idx
  on public.search_profiles (dataset);

create index if not exists search_profiles_embedding_hnsw
  on public.search_profiles
  using hnsw (embedding vector_cosine_ops);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists search_profiles_set_updated_at on public.search_profiles;

create trigger search_profiles_set_updated_at
before update on public.search_profiles
for each row
execute function public.set_updated_at();

create or replace function public.match_search_profiles(
  query_embedding vector(768),
  dataset_filter text,
  match_count int default 12,
  match_threshold float default 0
)
returns table (
  id text,
  dataset text,
  source_id text,
  full_name text,
  city text,
  county text,
  state text,
  age text,
  age_group text,
  party text,
  ethnicity text,
  language text,
  religion text,
  education text,
  occupation text,
  household text,
  income text,
  net_worth text,
  home_value text,
  property_type text,
  voter_engagement text,
  political_donor_type text,
  tags text[],
  summary text,
  similarity float
)
language sql
stable
as $$
  select
    search_profiles.id,
    search_profiles.dataset,
    search_profiles.source_id,
    search_profiles.full_name,
    search_profiles.city,
    search_profiles.county,
    search_profiles.state,
    search_profiles.age,
    search_profiles.age_group,
    search_profiles.party,
    search_profiles.ethnicity,
    search_profiles.language,
    search_profiles.religion,
    search_profiles.education,
    search_profiles.occupation,
    search_profiles.household,
    search_profiles.income,
    search_profiles.net_worth,
    search_profiles.home_value,
    search_profiles.property_type,
    search_profiles.voter_engagement,
    search_profiles.political_donor_type,
    search_profiles.tags,
    search_profiles.summary,
    1 - (search_profiles.embedding <=> query_embedding) as similarity
  from public.search_profiles
  where
    search_profiles.dataset = dataset_filter
    and 1 - (search_profiles.embedding <=> query_embedding) >= match_threshold
  order by search_profiles.embedding <=> query_embedding
  limit least(match_count, 50);
$$;
