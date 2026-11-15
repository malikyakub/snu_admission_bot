-- Make students.phone nullable so it matches supabase/schema.sql
-- (phone is collected at step 2; step 1 saves a draft keyed by conversation_id).
-- Run once in the Supabase SQL editor. Safe to re-run.

begin;

-- If the live table was created with phone as its primary key, move the
-- primary key to id first (a primary-key column cannot be made nullable).
alter table public.students
  add column if not exists id uuid default gen_random_uuid();
update public.students set id = gen_random_uuid() where id is null;

do $$
declare
  pk_name text;
  pk_cols text[];
begin
  select c.conname, array_agg(a.attname::text)
    into pk_name, pk_cols
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.conrelid = 'public.students'::regclass
    and c.contype = 'p'
  group by c.conname;

  if pk_name is not null and pk_cols = array['phone'] then
    execute format('alter table public.students drop constraint %I', pk_name);
    alter table public.students alter column id set not null;
    alter table public.students add primary key (id);
  end if;
end $$;

-- The app upserts on phone, so phone must stay unique (NULLs are allowed).
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.students'::regclass
      and i.indisunique
      and i.indnatts = 1
      and a.attname = 'phone'
  ) then
    alter table public.students
      add constraint students_phone_key unique (phone);
  end if;
end $$;

alter table public.students alter column phone drop not null;

commit;

-- Check: is_nullable should now be YES
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'students' and column_name = 'phone';
