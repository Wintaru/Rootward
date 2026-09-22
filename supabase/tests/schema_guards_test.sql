-- Schema guards: the shared-trigger coverage sets and blanket RLS assertions
-- that #4-#8 deferred to #9 (SPEC §4, §5; DECISIONS.md).
--
-- These are single-source-of-truth guards (AGENTS.md "Universal principles"):
-- adding the Nth genealogy table without wiring set_updated_at / write_audit_log
-- / RLS must fail here rather than ship a silent gap.

begin;
select plan(13);

-- set_updated_at is the concurrency token; SPEC §4 fixes the list to the 15
-- editable tables the edit view can send back.
select set_eq(
  $$ select c.relname::text
     from pg_trigger tr
     join pg_class c on c.oid = tr.tgrelid
     where tr.tgname = 'set_updated_at' and not tr.tgisinternal $$,
  $$ values ('person'),('person_name'),('family'),('family_child'),('event'),
            ('fact'),('place'),('source'),('repository'),('citation'),
            ('media'),('media_link'),('note'),('account'),('tree_settings') $$,
  'set_updated_at covers exactly the SPEC §4 editable-table list'
);

-- write_audit_log is the append-only trail over the genealogy tables + account
-- (SPEC §4.6). The #8 onboarding/job tables are deliberately excluded.
select set_eq(
  $$ select c.relname::text
     from pg_trigger tr
     join pg_class c on c.oid = tr.tgrelid
     where tr.tgname = 'write_audit_log' and not tr.tgisinternal $$,
  $$ values ('person'),('person_name'),('family'),('family_child'),('place'),
            ('event'),('fact'),('repository'),('source'),('citation'),
            ('media'),('media_link'),('note'),('account') $$,
  'write_audit_log covers exactly the genealogy tables + account'
);

-- Every table in public has RLS enabled (SPEC §5: "RLS enabled on every table").
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and not rowsecurity),
  0,
  'every public table has row-level security enabled'
);

-- Every table in public has at least one policy -- an enabled-but-policyless
-- table denies everything, which is almost never the intent.
select is(
  (select count(*)::int
   from pg_tables t
   where t.schemaname = 'public'
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = t.tablename
     )),
  0,
  'every public table has at least one RLS policy'
);

-- Table and sequence privileges (migration 20260922090000). RLS only filters
-- rows a role is already permitted to touch: with no GRANT, Postgres refuses at
-- the table level and PostgREST answers 42501 before any policy runs. The local
-- stack ships blanket grants on `public` and a fresh Supabase Cloud project
-- ships none, so a table added without a grant works locally and is unreadable
-- in production -- which is exactly how sign-in broke on the first hosted
-- deploy.
--
-- These join pg_class and test by oid. Reading `pg_tables` and rebuilding the
-- name is wrong: the planner may evaluate has_table_privilege before the
-- schemaname filter, and `auth.instances` then resolves as `public.instances`
-- and raises.
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not (
       has_table_privilege('authenticated', c.oid, 'SELECT')
       and has_table_privilege('authenticated', c.oid, 'INSERT')
       and has_table_privilege('authenticated', c.oid, 'UPDATE')
       and has_table_privilege('authenticated', c.oid, 'DELETE')
     )),
  0,
  'every public table grants select/insert/update/delete to authenticated'
);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not (
       has_table_privilege('service_role', c.oid, 'SELECT')
       and has_table_privilege('service_role', c.oid, 'INSERT')
       and has_table_privilege('service_role', c.oid, 'UPDATE')
       and has_table_privilege('service_role', c.oid, 'DELETE')
     )),
  0,
  'every public table grants select/insert/update/delete to service_role'
);

-- anon holds nothing at all. Asserted by reading the ACL rather than by
-- negating a list of verbs: the local template grants `all`, which is more than
-- the four DML verbs (TRUNCATE, REFERENCES, TRIGGER and, on PG17, MAINTAIN),
-- and a verb list would have to track whatever Postgres adds next. `acldefault`
-- stands in for a NULL relacl, which means "owner's defaults only".
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(
     coalesce(c.relacl, acldefault('r', c.relowner))
   ) a
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and a.grantee = 'anon'::regrole),
  0,
  'anon holds no privilege on any public table'
);

-- Sequences have no RLS, so a grant is the only control. anon with USAGE on
-- `audit_log_id_seq` could setval() the counter backwards and make every later
-- audited write fail on a primary-key collision.
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(
     coalesce(c.relacl, acldefault('S', c.relowner))
   ) a
   where n.nspname = 'public' and c.relkind = 'S'
     and a.grantee = 'anon'::regrole),
  0,
  'anon holds no privilege on any public sequence'
);

-- The polymorphic visibility helpers switch on an owner_type enum with a bare
-- CASE and no ELSE: an unhandled label collapses to NULL (a silent hidden row).
-- Guard that every enum label appears as a literal in the function body, so
-- adding a value to the enum without extending the helper fails here.
select is(
  (select count(*)::int
   from unnest(enum_range(null::public.citation_owner)) as label
   where pg_get_functiondef('public.citation_is_visible(uuid)'::regprocedure)
         not like '%''' || label || '''%'),
  0,
  'citation_is_visible handles every citation_owner label'
);

select is(
  (select count(*)::int
   from unnest(enum_range(null::public.media_owner)) as label
   where pg_get_functiondef('public.media_link_is_visible(uuid)'::regprocedure)
         not like '%''' || label || '''%'),
  0,
  'media_link_is_visible handles every media_owner label'
);

select is(
  (select count(*)::int
   from unnest(enum_range(null::public.note_owner)) as label
   where pg_get_functiondef('public.note_is_visible(uuid)'::regprocedure)
         not like '%''' || label || '''%'),
  0,
  'note_is_visible handles every note_owner label'
);

-- safeupdate (#100): PostgREST's `authenticator` session rejects any DELETE
-- or UPDATE with no WHERE, including one inside a function body, and pgTAP
-- never runs under it. `safeupdate_authenticator_test.sql` exercises the one
-- function built on unfiltered writes through a real such session; this
-- pair is a lint that catches the next one at the source -- a statement
-- with no WHERE anywhere in it, line comments stripped. A WHERE inside a
-- subquery and dynamic SQL slip past it; the dblink test is the backstop.
-- An intentional full-table write carries `where true` (see
-- `20260914133629_wipe_tree_safeupdate.sql`).
create function pg_temp.unfiltered_writes(p_verb text)
returns setof text
language sql
as $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral regexp_matches(
    regexp_replace(p.prosrc, '--[^\n]*', '', 'g'),
    '\m' || p_verb || '\s+[^;]*;',
    'gi'
  ) as stmt
  where n.nspname = 'public'
    and stmt[1] !~* '\mwhere\M'
$$;

select is_empty(
  $$ select * from pg_temp.unfiltered_writes('delete\s+from') $$,
  'no public function body has a DELETE without a WHERE clause'
);
select is_empty(
  $$ select * from pg_temp.unfiltered_writes('update') $$,
  'no public function body has an UPDATE without a WHERE clause'
);

select * from finish();
rollback;
