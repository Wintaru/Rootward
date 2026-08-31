-- Auth: create one `account` row for every new `auth.users` row.
-- Spec: docs/SPEC.md §9.1 (sign-in), §4.6 (account). Issue #17.
-- Depends on #7 (account table, account_role / account_status enums).
--
-- Sign-in is magic link + Google OAuth, no passwords (decision 11). GoTrue
-- writes the `auth.users` row; this trigger mirrors it into `public.account`
-- with the default role/status (`viewer` / `pending`) so the app always has an
-- account to read for a signed-in visitor. Approval and person-linking happen
-- later (issues #18-#20).
--
-- ADMIN_EMAIL bootstrap (decision 19) is deliberately NOT done here. A Postgres
-- trigger cannot read the deployment's environment, and Supabase local config
-- has no portable hook for a custom GUC. The web tier owns ADMIN_EMAIL: the
-- `/auth/callback` route promotes the matching account to active admin with the
-- service role. See docs/SPEC.md §9.1 and apps/web/lib/auth/bootstrap-admin.ts.

-- ---------------------------------------------------------------------------
-- handle_new_user -- AFTER INSERT on auth.users
--
-- SECURITY DEFINER so it can write `public.account` regardless of the caller
-- (GoTrue runs as the `supabase_auth_admin` role). search_path = '' so every
-- reference is schema-qualified and the definer's rights cannot be abused
-- through a hijacked search_path.
--
-- on conflict do nothing: a re-run (a manual account row, a replay) is a no-op
-- rather than an error. The trigger never overwrites an existing account.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      new.email
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'SPEC §9.1 / decision 11. AFTER INSERT on auth.users: create the matching '
  'public.account row (role = viewer, status = pending from the column '
  'defaults). ADMIN_EMAIL promotion is the web tier''s job -- see §9.1.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
