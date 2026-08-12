-- Allow role = 'admin' on messages (for admin handoff replies).
-- Run in Supabase SQL editor if the check constraint still excludes admin.

alter table public.messages drop constraint if exists messages_role_check;
alter table public.messages
  add constraint messages_role_check
  check (role in ('user', 'assistant', 'system', 'admin'));
