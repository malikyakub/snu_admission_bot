-- ============================================================
-- Lock down RLS: students, conversations, messages.
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- After this:
--   - anon (public key) cannot read or write students, conversations, messages
--   - the app server keeps full access through the service role
--   - signed-in admins (row in public.admins) can SELECT conversations and
--     messages, which the admin dashboard Realtime subscriptions need
-- ============================================================

begin;

-- 1. students: server-only
alter table public.students enable row level security;
revoke all on public.students from anon;

-- 2. conversations / messages: remove public read
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_select_public on public.conversations;
drop policy if exists messages_select_public on public.messages;

-- 3. Admin read (existing admins-table check)
drop policy if exists conversations_select_admin on public.conversations;
create policy conversations_select_admin
  on public.conversations
  for select
  to authenticated
  using (exists (select 1 from public.admins a where a.id = auth.uid()));

drop policy if exists messages_select_admin on public.messages;
create policy messages_select_admin
  on public.messages
  for select
  to authenticated
  using (exists (select 1 from public.admins a where a.id = auth.uid()));

commit;

-- Verify (expect rowsecurity = true for all three, and only the two
-- *_select_admin policies listed):
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public'
--      and tablename in ('students', 'conversations', 'messages');
--   select tablename, policyname, roles, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('students', 'conversations', 'messages');
