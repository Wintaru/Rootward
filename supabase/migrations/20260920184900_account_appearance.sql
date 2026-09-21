-- Per-member appearance (SPEC §8.1 `/settings`, §10 Phase 10, WAYFINDER
-- decision 38, issue #80). A theme and a colour mode are a preference of
-- one member, not a setting of the tree, so they live on `account` -- one
-- member's pick never changes what anyone else sees. The `rw-theme` /
-- `rw-mode` cookies the app also keeps are a mirror of these two columns
-- for the signed-out login page and the pre-paint script; when a session
-- exists the account wins.
--
-- The `theme` CHECK list restates `THEME_IDS` in
-- `apps/web/lib/theme/registry.ts`, and the `color_mode` list restates
-- `COLOR_MODES` in `apps/web/lib/theme/preference.ts`.
-- `apps/web/lib/theme/appearance-parity.test.ts` reads the newest definition
-- of each constraint out of this directory and fails when either side drifts. A
-- ninth theme therefore arrives as a new migration that drops and re-adds
-- `account_theme_check` -- a shipped migration is never edited.

alter table public.account
  add column theme text not null default 'flexoki'
    constraint account_theme_check check (theme in (
      'flexoki', 'rosepine', 'gruvbox', 'everforest',
      'heirloom', 'hearth', 'orchard', 'kodachrome'
    )),
  add column color_mode text not null default 'system'
    constraint account_color_mode_check
      check (color_mode in ('system', 'light', 'dark'));

comment on column public.account.theme is
  'SPEC §8.1, decision 38, #80. The member''s theme id -- one of the '
  'registry''s THEME_IDS; the CHECK list mirrors it.';
comment on column public.account.color_mode is
  'SPEC §8.1, decision 38, #80. system follows the device; light / dark pin '
  'one side.';

-- The only client write path for these two columns. RLS is row-level, and
-- `account_update` (migration 20260830174012) stays `is_admin()`: a viewer
-- may not UPDATE their own row directly, because that would open every
-- column (`role`, `status`, `person_id`). A column-limited grant is not an
-- option either -- `authenticated` needs the full UPDATE for the admin
-- flows. So the member's own write goes through this SECURITY DEFINER
-- function, which touches exactly `theme` and `color_mode` on exactly
-- `auth.uid()`'s row. The CHECK constraints above are the value guard; a bad
-- id raises `check_violation` rather than silently saving nothing.
create function public.set_appearance(p_theme text, p_color_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message =
      'set_appearance: a signed-in account is required';
  end if;

  update public.account
     set theme = p_theme,
         color_mode = p_color_mode
   where id = (select auth.uid());

  -- The post-sign-in trigger always creates the row, so this is a
  -- programming error surfaced, not a state to save nothing over.
  if not found then
    raise no_data_found using message =
      'set_appearance: no account row for the caller';
  end if;
end;
$$;

comment on function public.set_appearance(text, text) is
  'SPEC §8.1, decision 38, issue #80. Sets the caller''s own theme and colour '
  'mode -- the one client write path for those columns; every other account '
  'column stays behind account_update (is_admin()).';

revoke all on function public.set_appearance(text, text) from public, anon;
grant execute on function public.set_appearance(text, text) to authenticated;
