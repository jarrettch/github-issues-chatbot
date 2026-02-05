create extension if not exists vector;

create table issues (
  id bigserial primary key,
  issue_number integer not null unique,
  title text not null,
  body text,
  state text not null,
  labels text[] default '{}',
  author text,
  url text,
  created_at timestamptz,
  updated_at timestamptz,
  comments_count integer default 0,
  comments jsonb default '[]',
  linked_prs integer[] default '{}',
  content text not null,           -- combined text for RAG
  embedding vector(1536),
  synced_at timestamptz default now(),
  notified_at timestamptz           -- when notification was sent for this issue
);

create index on issues using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table sync_metadata (
  id integer primary key default 1,
  last_synced_at timestamptz,
  total_issues integer default 0
);
insert into sync_metadata (last_synced_at) values (null);

create or replace function match_issues(
  query_embedding vector(1536),
  match_count int default 5,
  match_threshold float default 0.15
) returns table (
  id bigint, issue_number integer, title text, body text, state text,
  labels text[], author text, url text, created_at timestamptz,
  updated_at timestamptz, comments_count integer, comments jsonb,
  linked_prs integer[], content text, similarity float
) language sql stable as $$
  select i.id, i.issue_number, i.title, i.body, i.state, i.labels,
    i.author, i.url, i.created_at, i.updated_at, i.comments_count,
    i.comments, i.linked_prs, i.content,
    1 - (i.embedding <=> query_embedding) as similarity
  from issues i
  where 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;
