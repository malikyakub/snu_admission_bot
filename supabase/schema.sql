-- ============================================================
-- SNUBot — full Supabase schema (single file)
-- Run once in the Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE throughout.
--
-- Sections:
--   1. Extensions
--   2. kb_chunks — vector search RPC (table must already exist)
--   3. conversations — chat sessions + handoff queue
--   4. messages — chat log (optional create)
--   5. students — status lookup + enrollment applications
--   6. Grants
-- ============================================================


-- ── 1. Extensions ───────────────────────────────────────────

create extension if not exists vector;


-- ── 2. kb_chunks — similarity search RPC ────────────────────
-- Requires public.kb_chunks with columns:
--   id uuid, content text, topic text, faculty text,
--   source_url text, confidence text, last_checked date,
--   embedding vector(768)

create or replace function public.match_kb_chunks(
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
  from public.kb_chunks c
  where
    (filter_topic is null or c.topic = filter_topic)
    and (filter_faculty is null or c.faculty = filter_faculty)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_kb_chunks(vector, int, text, text)
  to anon, authenticated, service_role;


-- ── 3. conversations ────────────────────────────────────────

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  needs_human boolean not null default false,
  handoff_offered boolean not null default false,
  waiting_for_phone boolean not null default false
);

alter table public.conversations
  add column if not exists needs_human boolean not null default false;

alter table public.conversations
  add column if not exists handoff_offered boolean not null default false;

alter table public.conversations
  add column if not exists waiting_for_phone boolean not null default false;

alter table public.conversations
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_conversations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_conversations_updated_at();

create index if not exists conversations_needs_human_idx
  on public.conversations (needs_human)
  where needs_human = true;


-- ── 4. messages ─────────────────────────────────────────────

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id, created_at);


-- ── 5. students ─────────────────────────────────────────────
-- id = primary key; phone becomes unique once collected (step 2).
-- conversation_id links partial enrollment before phone is known.

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  full_name text,
  enrollment_status text,
  current_step text,
  needs_human boolean not null default false,
  -- step 2
  mothers_name text,
  -- step 3
  gender text,
  date_of_birth date,
  place_of_birth text,
  -- step 4
  national_id text,
  nationality text,
  -- step 5
  region text,
  address text,
  -- step 6
  school_name text,
  school_country text,
  school_region_city text,
  -- step 7
  certificate_type text,
  exam_roll_number text,
  certificate_number text,
  -- step 8
  study_campus text,
  exam_location text,
  -- steps 9–11
  faculty_choice_1 text,
  faculty_choice_2 text,
  faculty_choice_3 text,
  -- step 12
  guardian_name text,
  guardian_mobile text,
  guardian_relation text,
  -- step 13 — document URLs
  doc_photo_url text,
  doc_id_url text,
  doc_certificate_url text,
  doc_payment_url text,
  -- meta
  conversation_id text unique,
  enrollment_step integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Guard columns on tables created before enrollment was added
alter table public.students add column if not exists id uuid default gen_random_uuid();
alter table public.students add column if not exists phone text;
alter table public.students add column if not exists full_name text;
alter table public.students add column if not exists enrollment_status text;
alter table public.students add column if not exists current_step text;
alter table public.students add column if not exists needs_human boolean not null default false;
alter table public.students add column if not exists mothers_name text;
alter table public.students add column if not exists gender text;
alter table public.students add column if not exists date_of_birth date;
alter table public.students add column if not exists place_of_birth text;
alter table public.students add column if not exists national_id text;
alter table public.students add column if not exists nationality text;
alter table public.students add column if not exists region text;
alter table public.students add column if not exists address text;
alter table public.students add column if not exists school_name text;
alter table public.students add column if not exists school_country text;
alter table public.students add column if not exists school_region_city text;
alter table public.students add column if not exists certificate_type text;
alter table public.students add column if not exists exam_roll_number text;
alter table public.students add column if not exists certificate_number text;
alter table public.students add column if not exists study_campus text;
alter table public.students add column if not exists exam_location text;
alter table public.students add column if not exists faculty_choice_1 text;
alter table public.students add column if not exists faculty_choice_2 text;
alter table public.students add column if not exists faculty_choice_3 text;
alter table public.students add column if not exists guardian_name text;
alter table public.students add column if not exists guardian_mobile text;
alter table public.students add column if not exists guardian_relation text;
alter table public.students add column if not exists doc_photo_url text;
alter table public.students add column if not exists doc_id_url text;
alter table public.students add column if not exists doc_certificate_url text;
alter table public.students add column if not exists doc_payment_url text;
alter table public.students add column if not exists conversation_id text;
alter table public.students add column if not exists enrollment_step integer not null default 0;
alter table public.students add column if not exists created_at timestamptz not null default now();
alter table public.students add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_students_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_students_updated_at();

create index if not exists students_phone_idx
  on public.students (phone);

create index if not exists students_conversation_id_idx
  on public.students (conversation_id);


-- ── 6. Grants ───────────────────────────────────────────────

grant select, insert, update on public.conversations to anon, authenticated, service_role;
grant select, insert         on public.messages      to anon, authenticated, service_role;
grant select, insert, update on public.students      to anon, authenticated, service_role;
grant select                 on public.kb_chunks     to anon, authenticated, service_role;
