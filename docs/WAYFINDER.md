# Wayfinder — Genealogy website

## Destination

A settled architecture, data model, and access model for the genealogy site MVP —
enough decisions locked that implementation becomes ordinary session work.

**Product sentence (amended 2026-09-12 by decision 36):** a family maintains
and grows its tree on a website it hosts itself. Viewers browse it, moderators
build and correct it, one admin runs it. "Maintains and grows" is the tiebreaker
for scope: a thing the site holds can be created, linked, and deleted from the UI.

MVP scope: import a GEDCOM, view the tree with a focused-person / root-generation
navigation, edit people in a MacFamilyTree-style full-screen panel as a moderator,
export a GEDCOM, with auth and a "claim your node" onboarding. Self-hostable and
open source is a constraint throughout, not a later add-on.
**⚠️ AMENDED 2026-09-12 by decision 36** — this sentence is a feature list, and
it was built literally: it never says a moderator _creates_ a person, _links_
two people, or _deletes_ one, so nothing downstream built those. The product
sentence above is the destination now. The feature list stays as the record of
what was originally asked. The **Journeys** section below is the other half of
the fix — it holds the capabilities no decision ever raised.

Reference material (in `docs/reference/`):
- `InitialIdeas.md` — original notes.
- `macfamilytree-person-editor.png` — MacFamilyTree person editor. Target for the
  edit view.
- `macfamilytree-interactive-view.png` — MacFamilyTree interactive view.
  Reference for generation bands, gender colors, and relative generation labels.
  Not a pixel target.
- React Flow home page (seen in chat 2026-08-30, superseded by decision 23) — the
  polish level Josh wants. The tree renderer is now `family-chart`.

## Decisions so far

Settled 2026-08-30 in one grilling session (all seven seed questions, walked in order).

1. **Source of truth — database is canonical; GEDCOM is import / export only.**
   Import seeds and re-seeds the tree. Export produces a faithful snapshot. No
   two-way merge engine. Schema keeps provenance (original GEDCOM `xref`, any
   `_UID`, an `imported_from` record) so a merge model stays possible later.
   Rejected: GEDCOM-file-canonical (would make the site view-only); true two-way
   sync (multi-month, out of scope).

2. **Relationship model — GEDCOM-style `family` records, first-class.**
   A `family` row = a couple with children. Partner roles stored as a role enum,
   not "husband" / "wife". Maps one-to-one to GEDCOM `FAM`, keeps import / export
   small. Rejected: edge model (`parent_child` + `partnership` tables) — cleaner
   in the abstract but makes export reconstruct `FAM` records.

3. **Events and facts — one typed `event` table and one typed `fact` table.**
   Each has a type (enum of known types plus a free-text fallback), structured
   GEDCOM date parts (not a real date — genealogy dates are "about 1850",
   "before 1900", ranges), an optional place reference, an optional value, and a
   link to its person or family. Citations attach to individual events and facts,
   not only to the person.

4. **GEDCOM fidelity insurance.** Every imported record keeps its original `xref`.
   Any tag not modelled explicitly is stored as raw structured JSON on that
   record and re-emitted on export. Goal: no silent data loss on a round trip.

5. **Places — own normalized table.** One row per place, events point at it.
   Enables a location lookup and a later map view.

6. **Access model — approved members see the whole tree.**
   Deceased people: fully visible. Living people: name, photo, relationships,
   life events visible; a fixed sensitive set (SSN, anything flagged `private`)
   hidden. Moderators and admins see everything. Enforced by Postgres row-level
   security, not frontend code. "Living" is computed: no death event and born
   within ~100 years, or an explicit `is_living` override (threshold is a
   setting).
   **Clarified 2026-08-30 by decision 35** — nothing is public. An unauthenticated
   visitor sees only the login page. No deceased-only public tier in the MVP.
   Rejected: distance-scoped visibility (recursive graph cost on the hot path);
   per-person privacy controls (v2). Schema is ready for per-person control — a
   `visibility` column on `person` and on `fact`, defaulting to the rule above.

7. **Opt-out `private` flag in the MVP.** A person can ask a moderator to hide
   their record. Moderator sets the flag.
   **Amended 2026-08-30 by decision 27** — the request is an in-app notification,
   not email. **Amended by decision 31** — post-MVP, the flag becomes the
   `moderators_only` / `hidden` rung of the per-person `visibility` ladder.

8. **Backend — Supabase only for the MVP.**
   Auth, Postgres, Storage, row-level security are native. GEDCOM import / export
   and thumbnailing run as Supabase Edge Functions. The importer is written as a
   portable module (parsing rules are the same in Deno or .NET) so a C# / iDesign
   service can take it over later if a host needs it. The importer is designed
   chunked and resumable from the start, because large trees are expected (Josh's
   own tree ~700 people now, expected to grow; multiple admins will accelerate
   growth).
   Rejected for now: a second C# service (two deploy targets, two languages,
   higher self-host barrier — not justified at MVP tree sizes).

9. **Tree view renderer — React Flow.**
   **⚠️ SUPERSEDED 2026-08-30 07:43 by decision 23** — renderer changed to
   `family-chart`. React Flow is dropped from the tree view (no other planned
   use). Still in force from this entry: generations visible up and down is a
   user setting, default 2 each way; neighborhood-only data loading — each focus
   change fetches only the visible neighborhood in one query, never the whole
   tree.

   Original text: Chosen for the polished look, built-in pan / zoom, and animated
   edges. A genealogy-aware layout pass computes node positions and feeds React
   Flow.

10. **View and edit share a typed data layer, not components.**
    Generated Supabase types plus a small query layer. The edit view is a
    separate full-screen mode (like MacFamilyTree's "Done" button), not a side
    panel.

11. **Auth — magic link + Google OAuth, no passwords for v1.**
    Supabase Auth. Email / password can be added later by a self-hoster.

12. **Two join paths.**
    - Moderator invite from a person record: moderator picks the node, types an
      email, invitee signs in, account auto-links to that node, approved
      immediately.
    - Self sign-up then match: invitee gives name + birth month / year (maybe a
      parent name), picks themselves from candidate matches. A successful match
      grants approved-member access immediately — no moderator approval step.
      Moderators can reassign or unlink a wrong claim. Self sign-up can be turned
      off by a host (invite-only tree).

13. **No match on self sign-up means no access.** The person sees a "request
    access" message that notifies a moderator. Keeps internet strangers out while
    letting real family in without friction. (Partially supersedes decision 6's
    "moderator approves members" framing — approval is now exception handling,
    not a gate, except for the no-match case.)

14. **One account links to at most one person node.** No parent-manages-child
    accounts. A child has no account until they want one. Hide-my-child requests
    go to a moderator ~~by email~~ **(amended by decision 27 — in-app
    notification, not email)**.

15. **Collaborative editing — Presence for the cue, version check for safety.**
    Supabase Realtime Presence shows "X is editing this field" (ephemeral,
    advisory). A `version` or `updated_at` column on the record is the real
    backstop: a save is rejected if the value changed since load. Likely MVP —
    Josh expects multiple moderators.

16. **In-app moderator alerts, no email.** A `notification` table (recipient,
    type, payload, read state, timestamp) written by events needing a moderator
    (person joined, access requested, hide request, bad-claim report). A bell
    with unread count, updated live by a Realtime subscription. Admins see this
    feed too. Likely MVP.

17. **Single-tenant.** One deployment hosts one family tree. No `tree_id` on any
    table. Others self-host their own clone and their own Supabase project.
    Matches the "run it on my Mac" and "clone and self-host" goals and the
    historical one-maintainer model. Rejected: multi-tenant (every policy must
    filter by `tree_id`, one miss leaks a family's data — a SaaS pivot, not an
    MVP need). Retrofitting `tree_id` later is a known migration.

18. **Three roles on the `account` row.**
    - `viewer` — approved member, reads per decision 6.
    - `moderator` — edits people / events / media / places, sends invites,
      handles claims, sees notifications, runs imports and exports.
    - `admin` — everything a moderator can do, plus role management, the settings
      page, and destructive actions (delete a person, wipe and re-import).

19. **First admin — admin email in an env var.** Safer for a public deployment.
    First-sign-in-wins was considered and rejected as less safe for a public
    host.

20. **Settings page (MVP scope).** Tree name and description, ~~public-visibility
    toggle~~ (removed by decision 35), self-sign-up on / off, living-person year
    threshold, role management. Everything else added as those features land.

## Decisions so far — frontier items resolved

Settled 2026-08-30, continuing the same session.

21. **Edit-view panel inventory.**
    - **MVP panels:** Name & Gender; Additional Names (`person_name` table, name
      types — nickname, married name); Events (Birth, Death, Marriage, Burial,
      Christening, Occupation, plus generic "add event type"); Facts (Eye Color,
      Height, SSN, Physical Description, Ethnic Origin, Skin Color — one typed
      `fact` table, same shape as `event`); Media (one primary photo per person);
      Notes (on person and on events); Source Citations (full model — see below);
      Reference Numbers (GEDCOM `xref`, FamilySearch ID, custom `REFN`).
    - **v2 panels:** Labels; Bookmarks / per-user start person; Influential
      Persons (`ASSO` — raw-JSON round-trip only for now); DNA test results
      (raw-JSON round-trip only); Stories; ToDos; Numbering System; Timeline /
      Plausibility / Map / Context computed tabs.
    - **Source citations — full GEDCOM model.** `source` records (title, author,
      publisher, repository), `citation` rows linking a source to a specific
      event or fact with page / quality / date, and `repository` records. Josh
      chose full over the reduced model — sourcing rigor matters to him.
    - **Start person — one tree-level default**, set in settings (decision 20).
      A new visitor sees that person first. Per-user bookmarks are v2.
    - **Change Log — plain database audit table for now**, not surfaced in the
      UI. A read-only per-person history is v2. The audit table is needed anyway
      for the multi-moderator version check (decision 15).
    **⚠️ AMENDED 2026-09-12 by decision 36** — the MVP panel list gains a ninth
    section, **Relationships** (add / remove parent, partner, child). The list
    above copied the MacFamilyTree person editor, which has no such panel because
    MacFamilyTree adds relatives on its tree canvas — and decision 23 made our
    tree navigate-only, so no screen could add a relative. Also amended: the
    Events panel names Marriage, but the build excluded family events from the
    person edit view — decision 36 puts them back, grouped per union. The Name &
    Gender panel gains the `visibility` and `is_living` controls decision 7
    promised ("moderator sets the flag").

22. **GEDCOM date model.**
    - **Storage — hybrid, raw plus parsed.** Each date value stores: `value_raw`
      (exact GEDCOM `DATE` payload, always round-trips); `kind` enum
      (`exact · about · estimated · calculated · before · after · between ·
      from_to · interpreted · phrase · unknown`); `year1 / month1 / day1` (month,
      day nullable); `year2 / month2 / day2` (ranges and periods); `calendar`
      enum default `gregorian`; `phrase` free text; `sort_key` generated column
      (missing month → 01, missing day → 01) for timeline ordering and "age at
      event". Rejected: string-only (kills sort / filter); structured-only (loses
      fidelity).
    - **Input — one smart text field with a live interpretation preview** and a
      hint about the shorthand (`abt`, `bet … and …`, `bef`, `aft`, `est`,
      `cal`, `from … to …`). Type `abt 1850`, see "About 1850" below the field.
      Unparseable input is saved as a `phrase` and flagged, not rejected.
      Rejected: structured qualifier + y/m/d picker (too many clicks, ranges need
      doubles).
    - **Calendars — Gregorian and Julian fully supported in v1** (parse, store,
      display, sort). Josh's tree reaches before 1752, so Julian and dual dates
      (`1700/01`, stored Julian with a flag, displayed as written) are in scope.
      Hebrew and French Republican: stored raw, shown as phrase, no conversion.

23. **Tree view renderer — `family-chart` (d3-based).** Amends decision 9.
    Chosen because it is purpose-built for screenshot 2's exact screen — an
    hourglass view (ancestors up, descendants down) from a focus person, with a
    native animated re-center on click. Removes the "will `relatives-tree` do the
    hourglass" risk.
    - **Custom HTML cards** (`family-chart` v2) carry the gender colors, photo,
      name, and dates from screenshot 2.
    - **Build straight against screenshot 2** — no design-canvas mock first. The
      screenshot is the target.
    - **Tradeoffs accepted:** less free-form control over the card (style within
      the library's card system); single-library coupling (one maintainer, its
      layout model); pedigree collapse (repeated ancestor via cousin marriage,
      expected in a pre-1752 tree) may need a workaround the library does not
      provide; no drag-to-edit canvas later without re-introducing React Flow.
      Acceptable because the tree view is navigate-only (decision 5).
    - Rejected: React Flow + `relatives-tree` (decision 9 — layout risk, no
      native re-center animation); studying `family-chart`'s transition code is
      moot now that it is the renderer.
    - Docs: https://github.com/donatso/family-chart

24. **Onboarding match algorithm.**
    - **Confirmation — challenge question, no candidate list.** Collect given
      name, surname, birth month, birth year. The server finds candidates
      silently. It then asks one or two facts only the real person knows —
      chosen from what the record holds: a parent's first name, a spouse's first
      name, birth place, birth day-of-month. A correct answer links to that
      candidate. Nothing about any candidate is shown until the match succeeds.
      Rejected: showing a candidate list (leaks living-person data to an
      unauthenticated visitor).
    - **Name matching — fuzzy, via Postgres `pg_trgm`.** Trigram similarity so
      "Kathryn" matches "Katherine" and minor misspellings match. Matched against
      all `person_name` variants (nicknames, maiden names). Birth year exact,
      birth month exact or ±1. The challenge answer is the real discriminator.
    - **On success — link, grant approved-member access immediately, and notify
      moderators** ("new self-claim: account X linked to person Y", decision 16).
      Not a gate. A moderator can reassign a bad match (decision 12). High
      uncertainty does not hold the claim — self-claim always succeeds if the
      challenge passes.
    - **Abuse control — cap challenge attempts** (about five per day per
      session). Over the cap routes to request-access (decision 13) and notifies
      a moderator.

25. **Media handling detail.**
    - **Allowed types — images and PDF only in v1** (JPEG, PNG, WebP, GIF, HEIC,
      PDF). The allowlist is a settings-page value (decision 20) so a self-hoster
      can widen it. Broad allowlist (documents, audio, video) rejected for v1.
    - **Size cap — 10 MB, as a setting.**
    - **Thumbnails and HEIC — an Edge Function on upload** generates two WebP
      derivatives: ~240 px thumbnail (lists, tree card) and ~1200 px display
      image. HEIC is converted to WebP (browsers cannot render HEIC). The
      original file is kept untouched for export and download.
    - **Storage — one private Supabase Storage bucket.** Files served through
      short-lived signed URLs, not public links, so media follows decision 6's
      access rules. Path shape: `person/{personId}/{mediaId}/original.ext`,
      `.../thumb.webp`, `.../display.webp`.
    - **EXIF — strip GPS coordinates on upload by default** (keep "date taken" as
      a media-date hint). A settings toggle can preserve full EXIF.
    - **Data model — a `media` table** (id, original filename, MIME, size,
      storage paths, caption, date) plus a `media_link` join table (owner type +
      id: person / event / fact / family / source, `is_primary` flag). Matches
      GEDCOM `OBJE` — one record referenced from many places.

26. **Collaborative editing scope.** Extends decision 15.
    - **Presence — record level.** A Realtime channel per person, `person:{id}`.
      Opening the edit view joins it and broadcasts `{ user, section }`. Others
      viewing that person (tree or edit view) see "X is editing this profile" and
      softly which section. Two moderators may both open the edit view.
    - **Version check — row level.** Every editable row carries `updated_at`:
      `person`, and each `event`, `fact`, `person_name`, `citation`,
      `media_link`, `source`, `place`, `family` row. The edit view loads a
      snapshot with those timestamps. Save sends only changed rows plus their
      loaded timestamp. A mismatch rejects only that row; the rest save.
    - **Conflict experience (v1)** — on a rejected row, show "This <row> was
      changed by <user> while you had it open" with their value and your value
      side by side, and two actions: keep mine (re-save over theirs) or take
      theirs (discard my change to that row). Per-field three-way merge is v2.
    - **The version check ships with the first edit-view release — non-negotiable.**
      If anything slips to a later release it is Presence, not the version check.
    Rejected: field-level locking; a single whole-profile lock blocking the
    second editor.

27. **Notification center scope.** Extends decision 16.
    - **v1 events:** self-claim succeeded and linked (decision 24); access
      requested with no node match (decision 13); challenge-attempt cap hit
      (decision 24); GEDCOM import finished or failed (decision 8); "hide my
      record" request (moved here from email — decisions 7 and 14 amended so this
      lands in the same queue).
    - **Shared queue.** One `notification` row visible to all moderators and
      admins. Read state per-user (`notification_read` join). "Handled" is
      global: `resolved_at` / `resolved_by` on the row. Read and resolved are
      separate.
    - **Auto-resolve.** When the underlying action happens the notification
      resolves itself (grant access → request resolves; reassign claim →
      self-claim notification resolves). Manual resolve for events with no single
      trigger.
    - **Retention.** Keep everything. View defaults to unresolved, with filters
      for resolved and all. Automatic archiving is later.
    - Amends decisions 7 and 14: "hide my record" requests are in-app
      notifications, not email.

28. **Root-generation navigation detail.**
    - **Band labels — both types, screenshot 2 wording.** A relative name from
      each node's depth relative to the focus person ("Root Generation",
      "Generation 1" upward, "Generation −1" downward) plus a birth-year range
      computed from the people in that band.
    - **v1 relative set:** direct ancestors to the depth setting (each couple,
      default 2 up); direct descendants to the depth setting (default 2 down);
      the focus person's siblings; the focus person's partners. Siblings of
      ancestors (aunts, uncles) and cousins are a post-v1 "show extended family"
      toggle — they multiply node count and work against neighborhood loading.
    - **Click behavior:** single click on any visible person re-centers the tree
      on them, animated. Opening the full profile or edit view is a separate
      action (card icon or double-click).
    - **Collapsed branches:** any node with relatives outside the current depth
      window shows an expand affordance (screenshot 2's down-arrow). Clicking it
      expands that one branch a level deeper without re-centering.
    - **Deep linking:** the focus person is in the URL (`/tree/:personId`).
      Views are shareable; the back button walks navigation history.

## Decisions so far — post-MVP items

Settled 2026-08-30 08:05, same session. These ship after the MVP; the decisions
are locked so the schema and architecture can accommodate them now.

29. **Scheduled backup export.** `pg_cron` triggers an Edge Function that runs the
    export. Destination: a private Storage bucket, last N archives on rotation.
    Frequency: a settings value, default daily. **Scope: full archive — GEDCOM
    plus media**, as a zip (Josh chose media included). Retention default is
    configurable and lower for full archives than a GEDCOM-only job would be,
    because media archives are large. An external target (S3, webhook) is a later
    add-on.

30. **Map view.** Geocode each `place` row on save through Nominatim
    (OpenStreetMap's free geocoder, no API key); store lat / long and the geocode
    source; manual pin override for wrong guesses. Map library: MapLibre GL JS
    with OpenStreetMap tiles — open source, no API key per deployment. Shows
    events that have a place, filterable by person, family, and date range.
    Migration paths (lines through one person's successive event places) are a
    nice-to-have on top. Detailed layout is a design pass at build time.

31. **Per-person privacy controls.** The v2 use of decision 6's `visibility`
    columns. **The default stays `everyone_approved` — any approved member sees
    any person's history** (deceased fully, living as basics per decision 6).
    These levels are opt-in restrictions on a specific record, not a default
    fence around each family group.
    - Four levels: `everyone_approved` (default), `close_family`,
      `moderators_only`, `hidden`.
    - `close_family` is an explicit small relationship set — parents, children,
      siblings, grandparents, grandchildren, spouse — computed only when someone
      views that one person (cheap; not a whole-tree traversal, which decision 6
      rejected globally).
    - Set by the linked account for their own record, a moderator for anyone, or
      an admin override.
    - Unifies decision 7: the MVP `private` flag becomes the `moderators_only` or
      `hidden` rung of this ladder, not a separate concept.

32. **Hosting and deploy.** A checklist, not a design fork.
    - Hosted path: Vercel (frontend) + Supabase Cloud (everything else), free
      tier.
    - Local path: Docker Compose running Supabase locally, `pnpm dev` for the
      frontend — the "run it on my Mac" story and the self-host reference.
    - CI: GitHub Actions — typecheck, lint, test, migration-check on every PR.
    - Repo ships `supabase/` migrations, seed data, a one-command local
      bootstrap, and deploy docs for both paths.
    - Provisioning deferred until close to a first deploy.

33. **Re-import experience.** Decision 1 makes re-import rare (first seed, or
    merging an emailed branch).
    - First import: straightforward load into an empty tree.
    - Later import: admin-only, automatic backup first (decision 29), then two
      modes:
      - **Replace-all** — only if no accounts are linked and no site edits exist
        since the last import; otherwise blocked behind a loud confirmation.
      - **Match-and-update** — matches incoming records to existing ones by the
        stored GEDCOM `xref` / `_UID` (decision 4), shows a diff preview (added,
        changed, removed), applies only what the admin approves. Never touches
        account-to-person links or media attachments — matched records keep them.
    - The diff-preview screen is the real post-MVP build. Replace-all is trivial.

## Decisions so far — spec-authoring follow-ups

Settled 2026-08-30 10:07 while writing `docs/SPEC.md`. Surfaced by a spec review
that found no numbered decision covered them.

34. **Frontend stack — Next.js (App Router) + TypeScript + Tailwind CSS +
    shadcn/ui.** React was in the original notes; Next.js is the natural Vercel
    pairing (decision 32). shadcn/ui is not a dependency — its CLI copies
    component source (Radix UI primitives styled with Tailwind) into the repo, so
    the project owns and edits them, with no runtime library or version lock.
    Chosen over plain Tailwind for the accessible primitives the dense edit view
    and the dialogs (`ConflictDialog`, media viewer) need. Rejected: React + Vite
    (loses Next.js routing / server components / Vercel integration); Tailwind
    alone (hand-building accessible dialogs, comboboxes, and menus).

35. **Nothing is public except the login page.** An unauthenticated visitor sees
    only `/login`. No deceased-only public tree in the MVP. The
    `public_visibility` setting from decision 20 is removed. A public read-only
    view stays a possible post-MVP feature. Amends decisions 6 and 20.

## Decisions so far — gap closure

Settled 2026-09-12 after a gap audit (`GAP-AUDIT-HANDOFF.md`, gitignored) found
that every numbered §10 item was built and the app was still not usable.

36. **In-app authoring — a moderator creates people and relationships without a
    GEDCOM.** Amends the destination and decision 21.
    - **What the audit found.** No sign-out, no navigation to `/import` /
      `/moderation` / `/settings`, no way to open a profile from the tree, a 404
      on a fresh deploy, no create-person, no add-parent / partner / child, no
      marriage editing, no delete, no wipe, no export button, no privacy
      controls, no hide-my-record request, no search. The database was ahead of
      the UI on every one of these: the RLS write policies, `person.visibility`,
      `person.is_living`, `export_job`, and the `hide_request` notification type
      all existed with no caller.
    - **Why the plan missed it.** Three things lined up. (1) The destination
      was a feature list — "import, view, edit, export" — and it never said
      _grow the tree_, so every later decision assumed the tree arrives by
      import. (2) Decision 21 copied the MacFamilyTree person editor's panels,
      and that screen has no relationships panel because MacFamilyTree adds
      relatives on its tree canvas — which decision 23 made navigate-only here.
      Together they closed the door on adding a relative without anyone
      noticing. (3) The build rule "do one issue, pull nothing forward" means
      plumbing with no issue (sign-out, navigation, empty state) never got a
      session. The spec review that added decisions 34–35 looked for missing
      technology choices, not missing user journeys.
    - **Destination.** Restated as a product sentence (see the top of this
      file). Create / link / delete for every entity follow from "maintains and
      grows" and need no further decision each.
    - **Relationships live in the edit view, not on the tree.** A ninth v1
      section: add parent, add partner, add child, remove from family. Each
      action resolves to `family` / `family_child` rows per decision 2. Picking
      an existing person or creating one inline are both allowed. The section
      also exposes what the schema already carries: `family.relationship_type`,
      per-parent `child_relation`, child `sort_order`, partner roles derived
      from sex but editable. A single known parent is a family with one partner
      null — a later "add parent" fills that slot. Removing the last member
      deletes the family row. The tree stays navigate-only (decision 23).
    - **Create a person.** A small form (given name, surname, sex — placeholders
      and `unknown` allowed, no birth date required) that lands in the edit
      view. `gedcom_xref` stays null until export assigns one.
    - **Family events.** Marriage, divorce, engagement, annulment are edited
      from either partner's edit view, grouped per union — `event.family_id`
      set, `person_id` null.
    - **The rest of the audit is journeys, not decisions.** Sign-out, role-gated
      navigation, "My record", the `/tree` index and empty state, import sets
      the root, profile from a tree card, root picker by name, export button,
      visibility + living controls, delete a person, wipe the tree with a
      backup export first, hide-my-record request, search + `/people`, invite
      from the profile, a mobile pass. Each was already promised by a decision
      (7, 12, 18, 28, 33) or is ordinary plumbing. They are listed under
      **Journeys** and built as Phase 9 (`docs/SPEC.md` §10).
    - **Rejected:** adding relatives on the tree canvas — it re-introduces the
      drag-to-edit tradeoff decision 23 gave up, and `family-chart`'s card
      system is not a form. Also rejected: a GEDCOM-only tree — a self-hoster
      with no existing file could never start.
    - **Process fix.** This map now carries a **Journeys** section, and the
      spec is derived from Journeys ∪ Decisions, never from decisions alone.
      The `wayfinder` skill's completeness pass (roles × entities × verbs,
      reachability, lifecycle, backend-has-a-front, reference product,
      reverse / repair, ordinary complaints) runs before a spec and again
      against the issue list.

## Decisions so far — hosted multi-tenancy planning

Settled 2026-09-13, prompted by Josh asking whether he could also run
Rootward as a hosted service (his own tree at `donner.rootward.family`,
other families on other subdomains he owns) alongside the open-source
self-host story.

37. **Hosted multi-tenancy is a real future phase, deliberately not started
    now.** Decision 17 stays in force for the current build: single-tenant,
    no `tree_id`, self-host is the only distribution model until the MVP
    (Phase 9 gap closure plus the remaining SPEC items) ships. Nothing here
    changes that.
    - **Why wait.** Nothing is deployed yet, so waiting costs nothing —
      there is no live data to migrate across tenants, which is normally the
      hard part of a multi-tenant retrofit. Starting it now would also mean
      every Phase 9 issue has to think about tenants on top of the
      usability gaps the 2026-09-12 audit already found, which is the wrong
      thing to be optimizing for while the single-tenant app still isn't
      fully usable.
    - **Why it's real, not just an idea.** It touches every table and every
      RLS policy (a retrofit decision 17 already anticipated as "known"),
      plus things that don't exist at all today: subdomain routing, tenant
      provisioning, and a legal/ops footing for hosting someone else's
      family data. That is a phase's worth of design work, not a follow-on
      issue.
    - **Tracking.** Milestone "Hosted Multi-Tenancy (Post-MVP)" on the
      `Wintaru/Rootward` repo, label `multi-tenant`. Eight frontier
      questions are open there, none to be worked until this phase starts:
      the tenant/account model (#89), unifying vs. diverging the self-host
      and hosted schema (#90 — the highest-leverage fork of the phase), the
      subdomain routing mechanism (#91), tenant provisioning/signup (#92),
      cross-tenant platform-operator access (#93), storage/signed-URL
      scoping (#94), tenant offboarding and deletion (#95), and legal/ops
      groundwork (#96, a checklist rather than a design question).
    - **Guidance for ongoing single-tenant work in the meantime.** Cheap,
      already-consistent-with-current-practice habits that keep the
      eventual retrofit mechanical instead of a rewrite — none of this is
      multi-tenant work, just not actively making it harder:
      - Keep RLS checks behind shared SQL helper functions (already the
        pattern — `is_moderator()` and siblings) rather than repeating
        boolean logic inline in each policy, so adding a tenant filter
        later is a change in a few places, not a search-and-replace across
        every policy.
      - Storage bucket policies today gate on `bucket_id = '<name>' and
        public.is_moderator()` — bucket plus role, no path scoping (see
        `imports`/`exports`/`media` bucket migrations). Don't add a bucket
        or policy that departs from that one shared shape, so a later
        per-tenant scheme can compose a tenant check onto the existing
        role check uniformly instead of special-casing an outlier.
      - Don't hardcode the deployment's domain in new code (redirect URLs,
        links in generated text) — read it from config/env. A hosted
        deployment has one domain per tenant, not one fixed host.
    - **Out of scope for this decision.** Any actual schema, routing, or
      provisioning work — this decision only commits to a tracked plan, per
      Josh's instruction to plan and ticket the phase without doing it.

## Decisions so far — theme system

Settled 2026-09-12 in a redesign session that mocked eight looks on one
shared page chassis (canvas:
<https://claude.ai/code/artifact/0551bb59-efd3-4a36-889f-4f0d88a437ff>,
pages 2–3). Recorded here 2026-09-20 by issue #74. Numbered 38, not 37 as
that issue says — 37 was taken by hosted multi-tenancy the day after #74
was filed.

38. **Theme system — a per-member theme picker on one chassis, not one house
    look.** Extends decision 34 (shadcn/ui + Tailwind stay the component
    base) and decision 20 (settings gain a per-member Appearance page).
    - **A theme is a token set on one chassis, never a per-theme component
      fork.** Every theme is one CSS file of custom properties — the shadcn
      set `globals.css` already maps (`--background`, `--card`, `--primary`,
      `--radius`, …) plus a Rootward set (`--font-display`, `--font-body`,
      `--rw-radius-control|avatar|pill`, `--rw-accent-2`,
      `--rw-male|female|neutral`, `--rw-band`, `--rw-link`, `--rw-shadow`).
      Components read tokens and nothing else. The few switches CSS cannot
      express as a variable (nav style, avatar shape, name face, wordmark
      mark, ground pattern) are data attributes on `<html>` set from a
      registry — no per-theme JSX branches. Selector contract:
      `<html data-theme="<id>">` for the theme and the existing `.dark` class
      for the mode, so one theme file carries a `[data-theme="x"]` block and
      a `[data-theme="x"].dark` block.
    - **Theme and light/dark mode are a per-member preference.** Two columns
      on `accounts` (`theme`, `color_mode` in `system | light | dark`),
      editable only on the member's own row. One member's pick never changes
      the tree for anyone else. The choice is mirrored to a cookie on sign-in
      and on every save, so `/login` and the first paint on that device match
      the last signed-in member — no flash of the wrong theme. Server reads
      cookie → account wins when signed in.
    - **The shortlist is eight themes, each with a native light and dark
      side.** Four MIT-licensed palettes people already know from their
      editors — Flexoki (Steph Ango), Rosé Pine (Dawn / Moon), Gruvbox
      (morhetz), Everforest (sainnhe) — and four originals — Heirloom,
      Hearth, Orchard, Kodachrome. Palette credits go in each file header and
      in `README.md`.
    - **The stock shadcn neutral becomes no theme at all.** One of the eight
      is the default (Flexoki, the proof theme in #75 — `DEFAULT_THEME` in the
      registry is where it is set), and `:root` carries that theme's values
      as the fallback for an unknown id. The current neutral values are
      deleted once the default theme's file exists.
    - **The shared chassis** every mock draws: a 64px header with a
      "Rootward" wordmark in the display face, nav links, a bell, and an
      **account chip** (initials disc, first name) whose menu holds My
      record, Appearance, and Sign out. On the tree, a **Generations panel**
      bottom-right (card tokens, two steppers, "Reset to defaults") replaces
      the black stepper overlay top-left. Section cards, buttons, and inputs
      move onto the shadcn `button` / `input` components pointed at the
      radius tokens.
    - **Contrast is measured, not assumed.** Every theme × mode passes WCAG
      AA (4.5:1 text, 3:1 non-text) before it is offered — a script reads the
      theme files and fails the test run under the bar; a failing token is
      lightened or darkened alone so the accent hues stay recognisable.
    - **Rejected.** One designed house look — it forces one taste on every
      family and the mocks made the case that the same chassis carries eight
      well. A per-tree theme set by the admin — the thing being personalised
      is one person's screen, and a per-member column costs the same as a
      per-tree one. A runtime theme library (next-themes and the like) for
      the switch — a cookie plus one inline pre-hydration script is the whole
      mechanism, and the account column, not `localStorage`, is the source
      of truth. Style container queries for the chassis switches — Firefox
      does not ship them, data attributes do the same job today.
    - **Tracking.** Milestone "Phase 10 — Theme system", label `phase:10`,
      issues #74–#81 in `docs/SPEC.md` §10, one session each: docs (#74),
      the token contract and registry (#75), the eight theme files (#76,
      #77), the tree on tokens (#78), the chrome on tokens (#79), the
      Appearance page (#80), and the contrast audit last (#81).

## Journeys

Added 2026-09-12 by decision 36. One line per thing a role must be able to do
from the UI. `(built)` names the §10 item that shipped it. `#NN` names the
Phase 9 or Post-MVP issue that builds it. A journey with neither is a gap.
The spec (`docs/SPEC.md`) is derived from this list plus the decisions.

**Not signed in**

- Sees `/login` only. Signs in by magic link or Google (built, 17).
- Opens an invite link, signs in, is linked and approved (built, 20).
- Opens an expired or used link and sees an error page (built, 17 / 20).

**Signed in, not yet approved**

- Claims their own record through the challenge (built, 18 / 19).
- Gets no match, or hits the attempt cap, and requests access (built, 18 / 19).
- Is suspended and sees a suspended-account screen (built, 19).
- Has `allow_self_signup` off and sees invite-only messaging (built, 19).

**Viewer** (any approved member)

- Lands on the default root person's tree (built, 23). On a fresh deploy with
  no root set, lands on a fallback person or an empty state, not a 404 (#51).
- Re-centers, expands a collapsed branch, walks back (built, 23 / 24).
- Opens a profile from a tree card by icon or double-click (#52).
- Finds a person by name from any page. Browses everyone at `/people` (#62).
- Opens their own record from the header (#50).
- Views a profile, its media, sources, and notes (built, 25 / 34).
- Asks a moderator to hide their record or their child's (#61).
- Signs out (#50).
- Does all of the above on a phone (#65).
- Picks a theme and a light / dark mode for their own screen; the login page
  on that device keeps it (#80, Phase 10).
- Suggests a correction to a moderator (#70, post-MVP).
- Sees a person's change history (#71, post-MVP).

**Moderator** (plus everything a viewer does)

- Reaches `/import` and `/moderation` from the header (#50).
- Imports a GEDCOM into an empty tree and watches the job (built, 16). Is
  blocked with a clear message when the tree is not empty (#60).
- Exports a GEDCOM and downloads it. Sees past export jobs (#54).
- Creates a person with no GEDCOM (#55).
- Edits name, additional names, events, facts, media, sources, notes,
  reference numbers (built, 27–31, 34).
- Adds and removes a parent, partner, or child. Sets relationship type, child
  relation, and child order (#56).
- Adds and edits a marriage or divorce (#57).
- Sets a person's visibility and living override (#58).
- Invites a person to claim, from their profile (#63) or from `/moderation`
  (built, 20).
- Handles access requests and self-claims. Reassigns or unlinks a wrong claim
  (built, 36). Deletes a pending invitation (built, 20).
- Sees notifications in the bell, marks read, resolves (built, 35).
- Edits at the same time as another moderator: presence cue, version check,
  conflict dialog (built, 31 / 32).
- Merges duplicate people (#66, post-MVP).
- Browses, renames, merges places (#67, post-MVP). Browses and edits sources
  and repositories from one index (#68, post-MVP).
- Attaches media to an event or a source, not only a person (#69, post-MVP).
- Works a data-quality list: no birth date, no parents, no sources (#72,
  post-MVP).

**Admin** (plus everything a moderator does)

- Reaches `/settings` from the header (#50).
- Picks the default root person by name (#53).
- Manages roles. Suspends and reactivates an account (built, #37).
- Deletes a person (#59).
- Wipes the tree, with a backup export first, then re-imports (#60).

**Lifecycle**

- Fresh deploy, empty tree: the empty state offers "Import a GEDCOM" and "Add
  the first person" (#51, #55).
- First import sets the default root person (#51).
- A failed import or export shows its error (built, 16 / #54).
- Zero search results show an empty result, not a blank page (#62).

## Status

All frontier items for the current build are resolved (2026-08-30). Decisions
1–35 are the full plan. **2026-09-12:** decision 36 amended the destination
and decision 21 after a gap audit. The Journeys section above is now the
second input to the spec. Phase 9 (`docs/SPEC.md` §10, issues #50–#65) builds
the missing journeys. No open frontier items block the current build.
**2026-09-13:** decision 37 opened a separate, future frontier for hosted
multi-tenancy (issues #89–#96, milestone "Hosted Multi-Tenancy (Post-MVP)") —
deliberately not started, tracked so it isn't lost and so ongoing work stays
aware of it.
**2026-09-20:** decision 38 recorded the theme system settled on 2026-09-12 —
Phase 10 (`docs/SPEC.md` §10, issues #74–#81) builds it after Phase 9.

Next step per the wayfinder pattern: turn this map into a spec, then break the
spec into GitHub issues on `Wintaru/Rootward`, then build. Decisions 1–28 cover
the MVP; 29–33 ship after and are already accounted for in the schema and
architecture.

Spec written: `docs/SPEC.md`. Ticketing: GitHub issues (not `trillian-tasks` —
Josh chose GitHub for this project, 2026-08-30). Session workflow: `CLAUDE.md`.

## Out of scope

- **Two-way GEDCOM sync / merge engine.** Explicitly ruled out for this effort.
- **Multi-tenant hosting / hosted SaaS.** Single-tenant only for the current
  build. **2026-09-13:** no longer ruled out permanently — planned as a
  distinct future phase, see decision 37.
- **Email notifications of any kind** beyond auth magic links.
- **Passwords for v1.**
- **A separate C# backend service** — deferred, not being built now; importer
  stays portable so the option survives.
- **OCR, PDF full-text search, face detection in photos.**
