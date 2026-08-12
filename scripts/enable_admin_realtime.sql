-- Enable Realtime + conversation title for admin Recent chats.
-- Run in Supabase SQL Editor once.

alter table public.conversations
  add column if not exists title text;

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null;
  end;
end $$;
