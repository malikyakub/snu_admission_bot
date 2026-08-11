-- Run this in the Supabase SQL Editor once.
-- Required by /api/chat for pgvector cosine similarity search.

create extension if not exists vector;

create or replace function match_kb_chunks(
  query_embedding vector(768),
  match_count int default 5,
  filter_topic text default null,
  filter_faculty text default null
)
returns table (
  id uuid,
  content text,
  topic text,
  faculty text,
  source_url text,
  confidence text,
  last_checked date,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.content,
    c.topic,
    c.faculty,
    c.source_url,
    c.confidence,
    c.last_checked,
    1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  where
    (filter_topic is null or c.topic = filter_topic)
    and (filter_faculty is null or c.faculty = filter_faculty)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Allow the API route (service role or anon) to call the RPC.
grant execute on function match_kb_chunks(vector, int, text, text) to anon, authenticated, service_role;
