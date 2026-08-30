-- Schema guards: the shared-trigger coverage sets and blanket RLS assertions
-- that #4-#8 deferred to #9 (SPEC §4, §5; DECISIONS.md).
--
-- These are single-source-of-truth guards (AGENTS.md "Universal principles"):
-- adding the Nth genealogy table without wiring set_updated_at / write_audit_log
-- / RLS must fail here rather than ship a silent gap.

begin;
select plan(7);

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

select * from finish();
rollback;
