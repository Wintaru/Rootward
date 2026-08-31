-- Realtime Authorization for the edit-view presence channel (SPEC §8.3 /
-- §8.5, WAYFINDER decision 26, §10 item 32).
--
-- `person:{id}` carries only a display name and which edit section someone is
-- in, but decision 6 says nothing is public and RLS is the access boundary
-- everywhere else (CLAUDE.md: "Frontend checks are convenience, not
-- security") -- a non-private Realtime channel is authorized by nothing at
-- all (Supabase evaluates RLS on `realtime.messages` only for a channel
-- joined with `config.private = true`), so the frontend's moderator-only
-- route gate was the *only* thing standing between this channel and anyone
-- holding the project's public anon key. Marking the channel private and
-- adding these policies puts the same `is_moderator()` boundary every other
-- write in this app already goes through in front of it (caught in code
-- review -- see DECISIONS.md).
--
-- `realtime.messages` ships from the Realtime extension with RLS already
-- enabled and zero policies (deny-all to every role but the table owner and
-- `service_role`, both BYPASSRLS) -- confirmed against the local stack, so no
-- `alter table ... enable row level security` is needed here, only the two
-- policies below.
--
-- Checked against the row's own `topic` column, not `realtime.topic()` --
-- that function only reflects which channel *this connection* is bound to,
-- so a policy written against it (an earlier draft of this migration) would
-- authorize a write tagged with any topic string at all, as long as the
-- connection happened to be joined to some `person:` channel. A pgTAP
-- assertion catching exactly that gap is why this reads the row instead
-- (`edit_presence_test.sql`, "cannot track presence on a non-person topic")
-- -- see DECISIONS.md. Matches Supabase's own row-column authorization
-- example (`topic LIKE 'room:%' AND EXISTS (...)`) rather than the
-- session-function one.

create policy edit_presence_select
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'presence'
    and topic like 'person:%'
    and public.is_moderator()
  );

create policy edit_presence_insert
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'presence'
    and topic like 'person:%'
    and public.is_moderator()
  );
