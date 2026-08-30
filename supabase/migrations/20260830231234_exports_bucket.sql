-- Private `exports` storage bucket for the gedcom-export edge function (SPEC §7,
-- issue #15, decision 29).
--
-- The function writes a generated GEDCOM to `exports/<export_job_id>.ged` under
-- the service role and hands the caller a short-lived signed URL. The bucket is
-- private: no anon or public read path, and the object rows are readable only by
-- a moderator (defense in depth behind the signed URL).
--
-- This is the first storage provisioning in the repo. `imports` (issue #14 /
-- #16) and the media buckets (issue #33) can follow the same shape.
--
-- `storage.objects` already has RLS enabled by the storage extension; the
-- service role keeps BYPASSRLS, so the function's writes are unaffected.

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

-- Moderators manage export objects; everyone else (approved members, anon) has
-- no row access. `(storage.foldername(name))` is not used -- every object sits at
-- the bucket root as `<job id>.ged`.
create policy exports_moderator_all
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'exports' and public.is_moderator())
  with check (bucket_id = 'exports' and public.is_moderator());
