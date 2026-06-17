create extension if not exists vector with schema extensions;

create table if not exists public.civic_people (
  person_id text primary key,
  name text not null,
  county text not null,
  city text not null,
  state text not null,
  age_bucket text not null,
  language_preference text not null,
  housing_status text not null,
  communication_channel text not null,
  communication_consent boolean not null,
  confidential_record boolean not null,
  registration_status text not null,
  ballot_status text not null,
  civic_topics text[] not null default '{}',
  election_admin_text_for_embedding text not null,
  benefits_text_for_embedding text not null,
  emergency_text_for_embedding text not null,
  embedding_text text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.civic_people enable row level security;

create index if not exists civic_people_embedding_hnsw
  on public.civic_people
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

drop trigger if exists civic_people_set_updated_at on public.civic_people;

create trigger civic_people_set_updated_at
before update on public.civic_people
for each row
execute function public.set_updated_at();

create or replace function public.match_civic_people(
  query_embedding vector(768),
  match_count int default 12,
  match_threshold float default 0
)
returns table (
  person_id text,
  name text,
  county text,
  city text,
  state text,
  age_bucket text,
  language_preference text,
  housing_status text,
  communication_channel text,
  registration_status text,
  ballot_status text,
  civic_topics text[],
  similarity float
)
language sql
stable
as $$
  select
    civic_people.person_id,
    civic_people.name,
    civic_people.county,
    civic_people.city,
    civic_people.state,
    civic_people.age_bucket,
    civic_people.language_preference,
    civic_people.housing_status,
    civic_people.communication_channel,
    civic_people.registration_status,
    civic_people.ballot_status,
    civic_people.civic_topics,
    1 - (civic_people.embedding <=> query_embedding) as similarity
  from public.civic_people
  where
    civic_people.communication_consent
    and not civic_people.confidential_record
    and 1 - (civic_people.embedding <=> query_embedding) >= match_threshold
  order by civic_people.embedding <=> query_embedding
  limit least(match_count, 50);
$$;
