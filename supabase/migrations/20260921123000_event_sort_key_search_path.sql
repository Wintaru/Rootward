-- `event_set_sort_key` (migration 20260830164537) called
-- `genealogy_date_sort_key` and `event_type_sort_ordinal` unqualified and
-- set no search_path, so it only worked when the caller's search_path
-- happened to include `public`. GoTrue's connection does not: deleting an
-- auth user cascades to `account`, whose `on delete set null` FKs update
-- every `event` row that account created, the trigger fires, and the delete
-- fails with "function genealogy_date_sort_key(...) does not exist". Seen
-- the first time a real import (14k rows) preceded an account deletion.
--
-- Same body as the original; only the qualification and `set search_path`
-- change, matching every other trigger function in the schema.

create or replace function public.event_set_sort_key()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d date := public.genealogy_date_sort_key(
    new.date_year1, new.date_month1, new.date_day1
  );
begin
  if d is null then
    new.sort_key := null;
  else
    new.sort_key := (d::timestamp at time zone 'UTC')
      + make_interval(secs => public.event_type_sort_ordinal(new.type));
  end if;
  return new;
end;
$$;
