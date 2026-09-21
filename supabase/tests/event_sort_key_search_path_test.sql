-- event_set_sort_key must not depend on the caller's search_path (migration
-- 20260921123000). GoTrue deletes an auth user with `public` off its
-- search_path; the cascade (`account` → `event.created_by` set null) fires
-- the trigger on every event that account created.

begin;
select plan(3);

-- `on_auth_user_created` (#17) makes the account row.
insert into auth.users (id) values ('51000000-0000-0000-0000-000000000001');
update public.account set role = 'moderator', status = 'active'
 where id = '51000000-0000-0000-0000-000000000001';

insert into public.person (id, given_name, created_by)
values ('51000000-0000-0000-0000-000000000010', 'Authored',
        '51000000-0000-0000-0000-000000000001');
insert into public.event
  (id, owner_type, person_id, type, date_year1, date_month1, date_day1,
   created_by)
values ('51000000-0000-0000-0000-000000000020', 'person',
        '51000000-0000-0000-0000-000000000010', 'birth', 1900, 5, 4,
        '51000000-0000-0000-0000-000000000001');

select is(
  (select sort_key from public.event
    where id = '51000000-0000-0000-0000-000000000020'),
  timestamptz '1900-05-04 00:00:00+00',
  'the trigger computed the sort key on insert'
);

-- The condition GoTrue runs under: `public` not on the search_path
-- (`extensions` stays so pgTAP itself resolves).
select set_config('search_path', 'pg_catalog, extensions', true);

select lives_ok(
  $$ delete from auth.users
      where id = '51000000-0000-0000-0000-000000000001' $$,
  'deleting the authoring user succeeds with public off the search_path'
);

select is(
  (select created_by from public.event
    where id = '51000000-0000-0000-0000-000000000020'),
  null,
  'the cascade nulled created_by and the trigger re-ran cleanly'
);

select * from finish();
rollback;
