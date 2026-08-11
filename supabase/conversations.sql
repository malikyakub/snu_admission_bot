-- Apply in Supabase SQL Editor (once).
-- Creates conversations for chat sessions + admin handoff queue.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Surfaces in the admin dashboard queue when true
  needs_human boolean not null default false,
  -- Set when bot offered handoff on a low-confidence answer; used to detect "yes"
  handoff_offered boolean not null default false
);

-- If the table already existed without these columns:
alter table public.conversations
  add column if not exists needs_human boolean not null default false;

alter table public.conversations
  add column if not exists handoff_offered boolean not null default false;

alter table public.conversations
  add column if not exists updated_at timestamptz not null default now();

create index if not exists conversations_needs_human_idx
  on public.conversations (needs_human)
  where needs_human = true;

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

grant select, insert, update on public.conversations to anon, authenticated, service_role;
