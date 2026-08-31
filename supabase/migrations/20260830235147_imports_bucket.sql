-- Private `imports` storage bucket for the gedcom-import edge function (SPEC §7,
-- issues #14 / #16, decision 8).
--
-- The `/import` UI uploads the chosen GEDCOM to `imports/<import_job_id>.ged`
-- with the moderator's own session, then invokes `gedcom-import`. The function
-- reads the file back under the service role (BYPASSRLS). The bucket is private:
-- no anon or public read path, and object rows are visible only to an active
-- moderator.
--
-- Same shape as `20260830231234_exports_bucket.sql`. `storage.objects` already
-- has RLS enabled by the storage extension.

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

-- Moderators manage import objects; approved members and anon have no row
-- access. Every object sits at the bucket root as `<job id>.ged`, so
-- `storage.foldername(name)` is not used.
create policy imports_moderator_all
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'imports' and public.is_moderator())
  with check (bucket_id = 'imports' and public.is_moderator());
