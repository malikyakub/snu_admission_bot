-- Add waiting_for_phone for enrollment status lookup flow.
-- Apply in Supabase SQL Editor.

alter table public.conversations
  add column if not exists waiting_for_phone boolean not null default false;
