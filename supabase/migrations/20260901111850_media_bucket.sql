-- Private `media` storage bucket for the media-process edge function (SPEC §7,
-- issue #33, decision 25).
--
-- The moderator's own session uploads the chosen file to a staging key
-- (`media/staging/<token>.<ext>`); `media-process` reads it back under the
-- service role, writes the processed objects to
-- `media/<media id>/original.<ext>`, `.../thumb.webp`, `.../display.webp`, and
-- removes the staging object. Same shape as `20260830231234_exports_bucket.sql`
-- / `20260830235147_imports_bucket.sql` -- the bucket is private, no anon or
-- public read path.
--
-- Read access for approved (non-moderator) members to view media -- decision
-- 25's "media follows decision 6's access rules" -- is deferred to #34, which
-- will generate signed URLs server-side (service role, past this policy,
-- gated on `media_link_is_visible` from #9) rather than granting a broader
-- `storage.objects` SELECT policy here.
--
-- `storage.objects` already has RLS enabled by the storage extension.

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- Moderators manage media objects (upload + the function's processed output);
-- approved members and anon have no direct row access.
create policy media_moderator_all
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'media' and public.is_moderator())
  with check (bucket_id = 'media' and public.is_moderator());
