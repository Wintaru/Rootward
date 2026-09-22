-- Table and sequence privileges for the PostgREST roles.
--
-- RLS is the access boundary (SPEC §5), but RLS only filters rows a role is
-- already permitted to touch. With no GRANT, Postgres refuses at the table
-- level and PostgREST answers 42501 "permission denied for table" before any
-- policy is consulted.
--
-- Every migration until now granted EXECUTE on functions and nothing at all on
-- tables. That was invisible locally, because the CLI's `public` schema ships
-- with blanket grants to anon / authenticated / service_role. A fresh Supabase
-- Cloud project ships none, so the first hosted deploy could not read a single
-- row: the `ADMIN_EMAIL` bootstrap in `/auth/callback` failed with 42501 on
-- `account`, and took sign-in down with it (2026-09-22).
--
-- Who gets what, and why:
--
--   authenticated  select / insert / update / delete. Every RLS policy targets
--                  this role and only this role, so the policies keep doing the
--                  real filtering. Nothing in the schema TRUNCATEs -- wipe_tree
--                  uses DELETE -- so the four DML verbs are the whole need.
--
--   service_role   The same. It bypasses RLS by design, and the admin bootstrap
--                  and the edge functions run as it.
--
--   anon           Nothing. No policy targets anon, so it could read no row
--                  even with a grant, and the app never reads a table as anon:
--                  `getCurrentAccount` returns before the `account` query when
--                  there is no session, and `onboarding_match_search` -- the
--                  one function exposed to signed-out visitors -- is SECURITY
--                  DEFINER. Leaving anon bare puts a second lock behind RLS, so
--                  a future policy written `to public` cannot publish the tree
--                  on its own.
--
-- `revoke all` before each grant is deliberate, not belt-and-braces. The local
-- template runs `alter default privileges ... grant all on tables to ... anon`,
-- and `all` is more than the four DML verbs: it also carries TRUNCATE,
-- REFERENCES, TRIGGER and (PG17) MAINTAIN. Revoking only insert/update/delete
-- would leave anon holding TRUNCATE on every table, and TRUNCATE is the one
-- write verb RLS never sees.
--
-- The `alter default privileges` statements are the load-bearing part. Without
-- them this repairs today's tables and the next one added silently reopens the
-- same production-only hole. They register against the role running the
-- migration, so they cover tables created by later migrations -- which is the
-- only way tables are created here ("Schema is migrations"). A table created
-- by hand through Studio falls under a different `pg_default_acl` row and is
-- not covered; `schema_guards_test.sql` is what catches that.

grant usage on schema public to authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

-- `public.audit_log_id_seq` backs `audit_log.id`. `write_audit_log` is SECURITY
-- DEFINER so it does not need these grants today, but a sequence has no RLS:
-- anon holding USAGE could `setval()` the counter backwards and make every
-- later audited write fail on a primary-key collision.
grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public
  revoke all on tables from anon;

alter default privileges in schema public
  revoke all on sequences from anon;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
