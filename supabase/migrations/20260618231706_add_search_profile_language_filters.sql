drop function if exists public.match_search_profiles(vector(768), text, int, float);
drop function if exists public.match_search_profiles(vector(768), text, int, float, text[], text[]);

create or replace function public.matches_text_filters(
  field_value text,
  included_values text[] default '{}',
  excluded_values text[] default '{}'
)
returns boolean
language sql
stable
as $$
  select
    (
      coalesce(array_length(included_values, 1), 0) = 0
      or exists (
        select 1
        from unnest(included_values) as included_value
        where field_value ilike '%' || included_value || '%'
      )
    )
    and (
      coalesce(array_length(excluded_values, 1), 0) = 0
      or field_value is null
      or not exists (
        select 1
        from unnest(excluded_values) as excluded_value
        where field_value ilike '%' || excluded_value || '%'
      )
    );
$$;

create or replace function public.match_search_profiles(
  query_embedding vector(768),
  dataset_filter text,
  match_count int default 12,
  match_threshold float default 0,
  included_languages text[] default '{}',
  excluded_languages text[] default '{}',
  included_parties text[] default '{}',
  excluded_parties text[] default '{}',
  included_ethnicities text[] default '{}',
  excluded_ethnicities text[] default '{}'
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
    and matches_text_filters(search_profiles.language, included_languages, excluded_languages)
    and matches_text_filters(search_profiles.party, included_parties, excluded_parties)
    and matches_text_filters(search_profiles.ethnicity, included_ethnicities, excluded_ethnicities)
  order by search_profiles.embedding <=> query_embedding
  limit least(match_count, 50);
$$;
