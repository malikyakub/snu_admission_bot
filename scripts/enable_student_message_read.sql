-- Allow anonymous student clients to read conversations/messages by id
-- (needed for Realtime + direct Supabase selects).
-- The app also loads via GET /api/conversations/[id] (service role) as the primary path.
-- Safe to re-run.

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_select_public on public.conversations;
create policy conversations_select_public
  on public.conversations
  for select
  to anon, authenticated
  using (true);

drop policy if exists messages_select_public on public.messages;
create policy messages_select_public
  on public.messages
  for select
  to anon, authenticated
  using (true);

-- Inserts/updates stay on the server (service role) via /api/chat and admin routes.
