import { ONE_PIXEL_PNG } from "./png";
import { admin, type TableInsert } from "./supabase-admin";

type EventInsert = TableInsert<"event">;

/**
 * A small, self-contained family the suite owns end to end.
 *
 * The local stack ships a demo tree (`supabase/seed.sql`) and a developer
 * box usually holds an imported GEDCOM on top of it, so no assertion may
 * depend on what happens to be in the database. Every test that needs a
 * person uses one of these instead. The ids are fixed, in an `e0…` range
 * that neither the seed (`d…`) nor the pgTAP fixtures (`a…`/`b…`/`c…`) use,
 * so a re-run replaces the same rows rather than piling up new ones.
 *
 * The surname is deliberately odd ("Qatestsson"): `/people`'s filter and the
 * header search box can match it without colliding with real data.
 */

const id = (suffix: string): string => `e0000000-0000-4000-8000-0000${suffix}`;

export const FIXTURE_SURNAME = "Qatestsson";

/**
 * The surname every throwaway person gets (`support/scratch.ts`), kept apart
 * from {@link FIXTURE_SURNAME} on purpose.
 *
 * The app's searches are capped — 8 rows for a person picker, 20 for the
 * header box, 50 per page on `/people` — and sorted by surname first. Sharing
 * one surname put dozens of scratch rows in front of the fixture family in
 * every one of those lists, so a spec asserting "Gideon is in the results"
 * became a coin flip. The teardown sweeps this surname too, so a row leaked
 * by a failed test is still cleaned up.
 */
export const SCRATCH_SURNAME = "Scratchtestsson";

/**
 * A second, deliberately large family. `/people` and the header search
 * resolve a filter to a list of ids and then re-query with `.in("id", …)`,
 * so the request URL grows with the number of matches — past roughly 200 it
 * exceeds the gateway's URI limit and the page fails. A real tree hits this
 * easily (the surname a family tree is *about* is its most common one), so
 * the suite carries a surname big enough to cross the line on purpose.
 *
 * It is also what makes the pagination tests deterministic: 220 people is
 * five pages at `PEOPLE_PAGE_SIZE = 50`, whatever else is in the database.
 */
export const BULK_SURNAME = "Bulktestsson";
export const BULK_COUNT = 220;

export const fixtureIds = {
  grandfather: id("00000001"),
  grandmother: id("00000002"),
  /** The person the `viewer` account claims. */
  viewerPerson: id("00000003"),
  viewerSpouse: id("00000004"),
  child: id("00000005"),
  /** `visibility = 'hidden'` — invisible to everyone but a moderator. */
  hidden: id("00000006"),
  /** `visibility = 'moderators_only'`. */
  moderatorsOnly: id("00000007"),
  /** `visibility = 'close_family'` — post-MVP, so also moderator-only today. */
  closeFamily: id("00000008"),
  /** Nobody's relative: used for "create", "delete", and 404-ish paths. */
  loner: id("00000009"),
  elderFamily: id("0000000a"),
  youngerFamily: id("0000000b"),
} as const;

/** Given names on their own — the claim flow asks for the two parts apart. */
export const fixtureGivenNames = {
  grandfather: "Gideon",
  grandmother: "Greta",
  viewerPerson: "Vera",
  child: "Cora",
} as const;

/** Birth years the onboarding match is keyed on. Must track `events` below. */
export const fixtureBirthYears = {
  grandfather: 1901,
  grandmother: 1904,
  viewerPerson: 1958,
} as const;

export const fixtureNames = {
  grandfather: `Gideon ${FIXTURE_SURNAME}`,
  grandmother: `Greta ${FIXTURE_SURNAME}`,
  viewerPerson: `Vera ${FIXTURE_SURNAME}`,
  viewerSpouse: `Viggo ${FIXTURE_SURNAME}`,
  child: `Cora ${FIXTURE_SURNAME}`,
  hidden: `Hilda ${FIXTURE_SURNAME}`,
  moderatorsOnly: `Mortimer ${FIXTURE_SURNAME}`,
  closeFamily: `Clara ${FIXTURE_SURNAME}`,
  loner: `Lonnie ${FIXTURE_SURNAME}`,
} as const;

type PersonRow = {
  id: string;
  given_name: string;
  surname: string;
  sex: "male" | "female" | "unknown";
  is_living: boolean | null;
  visibility:
    "everyone_approved" | "close_family" | "moderators_only" | "hidden";
};

const persons: PersonRow[] = [
  {
    id: fixtureIds.grandfather,
    given_name: "Gideon",
    surname: FIXTURE_SURNAME,
    sex: "male",
    is_living: false,
    visibility: "everyone_approved",
  },
  {
    id: fixtureIds.grandmother,
    given_name: "Greta",
    surname: FIXTURE_SURNAME,
    sex: "female",
    is_living: false,
    visibility: "everyone_approved",
  },
  {
    id: fixtureIds.viewerPerson,
    given_name: "Vera",
    surname: FIXTURE_SURNAME,
    sex: "female",
    is_living: true,
    visibility: "everyone_approved",
  },
  {
    id: fixtureIds.viewerSpouse,
    given_name: "Viggo",
    surname: FIXTURE_SURNAME,
    sex: "male",
    is_living: true,
    visibility: "everyone_approved",
  },
  {
    id: fixtureIds.child,
    given_name: "Cora",
    surname: FIXTURE_SURNAME,
    sex: "female",
    is_living: true,
    visibility: "everyone_approved",
  },
  {
    id: fixtureIds.hidden,
    given_name: "Hilda",
    surname: FIXTURE_SURNAME,
    sex: "female",
    is_living: true,
    visibility: "hidden",
  },
  {
    id: fixtureIds.moderatorsOnly,
    given_name: "Mortimer",
    surname: FIXTURE_SURNAME,
    sex: "male",
    is_living: true,
    visibility: "moderators_only",
  },
  {
    id: fixtureIds.closeFamily,
    given_name: "Clara",
    surname: FIXTURE_SURNAME,
    sex: "female",
    is_living: true,
    visibility: "close_family",
  },
  {
    id: fixtureIds.loner,
    given_name: "Lonnie",
    surname: FIXTURE_SURNAME,
    sex: "unknown",
    is_living: null,
    visibility: "everyone_approved",
  },
];

function fail(label: string, message: string | undefined): never {
  throw new Error(`fixture ${label}: ${message ?? "unknown error"}`);
}

/** The large-family rows — fixed ids in their own `e1…` block. */
function bulkPersons(): PersonRow[] {
  return Array.from({ length: BULK_COUNT }, (_, index) => ({
    id: `e1000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    given_name: `Bulk${String(index).padStart(3, "0")}`,
    surname: BULK_SURNAME,
    sex: "unknown" as const,
    is_living: false,
    visibility: "everyone_approved" as const,
  }));
}

/**
 * Build both fixture families. Idempotent: fixed ids mean a second run
 * upserts the same rows.
 */
export async function seedFixtureFamily(): Promise<void> {
  const bulk = await admin
    .from("person")
    .upsert(bulkPersons(), { onConflict: "id" });
  if (bulk.error !== null) {
    fail("bulk persons", bulk.error.message);
  }

  const personResult = await admin
    .from("person")
    .upsert(persons, { onConflict: "id" });
  if (personResult.error !== null) {
    fail("persons", personResult.error.message);
  }

  const familyResult = await admin.from("family").upsert(
    [
      {
        id: fixtureIds.elderFamily,
        partner1_id: fixtureIds.grandfather,
        partner2_id: fixtureIds.grandmother,
        partner1_role: "husband",
        partner2_role: "wife",
        relationship_type: "married",
      },
      {
        id: fixtureIds.youngerFamily,
        partner1_id: fixtureIds.viewerSpouse,
        partner2_id: fixtureIds.viewerPerson,
        partner1_role: "husband",
        partner2_role: "wife",
        relationship_type: "married",
      },
    ],
    { onConflict: "id" },
  );
  if (familyResult.error !== null) {
    fail("families", familyResult.error.message);
  }

  // Children of the elder couple: the viewer's own person plus the three
  // restricted-visibility siblings the RLS tests need.
  const childResult = await admin.from("family_child").upsert(
    [
      {
        family_id: fixtureIds.elderFamily,
        person_id: fixtureIds.viewerPerson,
        sort_order: 1,
      },
      {
        family_id: fixtureIds.elderFamily,
        person_id: fixtureIds.hidden,
        sort_order: 2,
      },
      {
        family_id: fixtureIds.elderFamily,
        person_id: fixtureIds.moderatorsOnly,
        sort_order: 3,
      },
      {
        family_id: fixtureIds.elderFamily,
        person_id: fixtureIds.closeFamily,
        sort_order: 4,
      },
      {
        family_id: fixtureIds.youngerFamily,
        person_id: fixtureIds.child,
        sort_order: 1,
      },
    ],
    { onConflict: "family_id,person_id" },
  );
  if (childResult.error !== null) {
    fail("children", childResult.error.message);
  }

  await seedEvents();
}

/** Derived from the table's own Insert type rather than restated, so a
 * schema change fails here instead of at run time. */
type EventRow = Pick<
  EventInsert,
  | "owner_type"
  | "person_id"
  | "family_id"
  | "type"
  | "date_value_raw"
  | "date_kind"
  | "date_year1"
  | "date_month1"
  | "date_day1"
>;

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const events: EventRow[] = [
  personEvent(fixtureIds.grandfather, "birth", 1901, 3, 4),
  personEvent(fixtureIds.grandfather, "death", 1975, 11, 2),
  personEvent(fixtureIds.grandmother, "birth", 1904, 6, 19),
  personEvent(fixtureIds.grandmother, "death", 1988, 1, 30),
  personEvent(fixtureIds.viewerPerson, "birth", 1958, 5, 12),
  personEvent(fixtureIds.viewerSpouse, "birth", 1956, 9, 8),
  personEvent(fixtureIds.child, "birth", 1984, 2, 29),
  personEvent(fixtureIds.hidden, "birth", 1960, 4, 1),
  personEvent(fixtureIds.moderatorsOnly, "birth", 1962, 7, 21),
  personEvent(fixtureIds.closeFamily, "birth", 1964, 10, 5),
];

function personEvent(
  personId: string,
  type: EventRow["type"],
  year: number,
  month: number,
  day: number,
): EventRow {
  return {
    owner_type: "person",
    person_id: personId,
    type,
    date_value_raw: `${day} ${MONTHS[month - 1]} ${year}`,
    date_kind: "exact",
    date_year1: year,
    date_month1: month,
    date_day1: day,
  };
}

/**
 * Events carry generated ids, so re-running would duplicate them. Clear this
 * family's events first, then insert the known set.
 */
async function seedEvents(): Promise<void> {
  const personIds = persons.map((person) => person.id);
  const clearPersonEvents = await admin
    .from("event")
    .delete()
    .in("person_id", personIds);
  if (clearPersonEvents.error !== null) {
    fail("event cleanup", clearPersonEvents.error.message);
  }

  const clearFamilyEvents = await admin
    .from("event")
    .delete()
    .in("family_id", [fixtureIds.elderFamily, fixtureIds.youngerFamily]);
  if (clearFamilyEvents.error !== null) {
    fail("family event cleanup", clearFamilyEvents.error.message);
  }

  const insert = await admin.from("event").insert([
    ...events,
    {
      owner_type: "family",
      family_id: fixtureIds.elderFamily,
      type: "marriage",
      date_value_raw: "14 JUN 1927",
      date_kind: "exact",
      date_year1: 1927,
      date_month1: 6,
      date_day1: 14,
    },
  ]);
  if (insert.error !== null) {
    fail("events", insert.error.message);
  }
}

/**
 * Remove the fixture family. `person` cascades to its events, names, and
 * `family_child` rows; the two families are deleted explicitly because their
 * partner columns are `on delete set null`, not cascade.
 */
export async function removeFixtureFamily(): Promise<void> {
  // By surname, not by id list: 220 ids in a URL is exactly the limit this
  // fixture exists to demonstrate.
  const bulk = await admin.from("person").delete().eq("surname", BULK_SURNAME);
  if (bulk.error !== null) {
    fail("bulk cleanup", bulk.error.message);
  }

  // An account that claimed a fixture person would block nothing (the FK is
  // `on delete set null`), but unlink first so a half-torn-down run cannot
  // leave an account pointing at a person that no longer exists.
  const unlink = await admin
    .from("account")
    .update({ person_id: null })
    .in(
      "person_id",
      persons.map((person) => person.id),
    );
  if (unlink.error !== null) {
    fail("account unlink", unlink.error.message);
  }

  const families = await admin
    .from("family")
    .delete()
    .in("id", [fixtureIds.elderFamily, fixtureIds.youngerFamily]);
  if (families.error !== null) {
    fail("family cleanup", families.error.message);
  }

  const removed = await admin
    .from("person")
    .delete()
    .in(
      "id",
      persons.map((person) => person.id),
    );
  if (removed.error !== null) {
    fail("person cleanup", removed.error.message);
  }

  // Tests create people of their own (`/person/new`, the edit view's scratch
  // rows) and record the id only once the request succeeded — a test that
  // fails partway leaks the row. The surname exists precisely because it
  // cannot collide with real data, so sweep by it as well as by id.
  const strays = await admin
    .from("person")
    .delete()
    .in("surname", [FIXTURE_SURNAME, `O'${FIXTURE_SURNAME}`, SCRATCH_SURNAME]);
  if (strays.error !== null) {
    fail("stray cleanup", strays.error.message);
  }
}

/**
 * One media item attached to a fixture person, so `/media/[mediaId]` and the
 * profile gallery have something real to render — a signed URL to an actual
 * object in the `media` bucket, not a row pointing at nothing.
 *
 * The bytes are a 1×1 PNG. `media-urls.ts` signs whatever path the row
 * names under the service role, so the viewer only needs the object to
 * exist; nothing here decodes it.
 */
export const fixtureMediaId = "e0000000-0000-4000-8000-0000000000c1";
export const FIXTURE_MEDIA_TITLE = "Qatestsson family portrait";

const MEDIA_BUCKET = "media";

export async function seedFixtureMedia(): Promise<void> {
  const paths = {
    original: `${fixtureMediaId}/original.png`,
    thumb: `${fixtureMediaId}/thumb.png`,
    display: `${fixtureMediaId}/display.png`,
  };

  for (const path of Object.values(paths)) {
    const upload = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(path, ONE_PIXEL_PNG, {
        contentType: "image/png",
        upsert: true,
      });
    if (upload.error !== null) {
      fail("media upload", upload.error.message);
    }
  }

  const row = await admin.from("media").upsert(
    {
      id: fixtureMediaId,
      original_filename: "portrait.png",
      mime_type: "image/png",
      size_bytes: ONE_PIXEL_PNG.byteLength,
      storage_path_original: paths.original,
      storage_path_thumb: paths.thumb,
      storage_path_display: paths.display,
      title: FIXTURE_MEDIA_TITLE,
      date_value_raw: "1927",
      date_kind: "exact",
      date_year1: 1927,
    },
    { onConflict: "id" },
  );
  if (row.error !== null) {
    fail("media row", row.error.message);
  }

  // Re-created rather than upserted: `media_link` has no natural key to
  // conflict on, and a partial unique index already guards "one primary".
  const unlink = await admin
    .from("media_link")
    .delete()
    .eq("media_id", fixtureMediaId);
  if (unlink.error !== null) {
    fail("media link cleanup", unlink.error.message);
  }

  const link = await admin.from("media_link").insert({
    media_id: fixtureMediaId,
    owner_type: "person",
    owner_id: fixtureIds.grandfather,
    is_primary: true,
    caption: "The only photo of Gideon",
  });
  if (link.error !== null) {
    fail("media link", link.error.message);
  }
}

export async function removeFixtureMedia(): Promise<void> {
  const link = await admin
    .from("media_link")
    .delete()
    .eq("media_id", fixtureMediaId);
  if (link.error !== null) {
    fail("media link teardown", link.error.message);
  }

  const row = await admin.from("media").delete().eq("id", fixtureMediaId);
  if (row.error !== null) {
    fail("media teardown", row.error.message);
  }

  const objects = await admin.storage
    .from(MEDIA_BUCKET)
    .remove([
      `${fixtureMediaId}/original.png`,
      `${fixtureMediaId}/thumb.png`,
      `${fixtureMediaId}/display.png`,
    ]);
  if (objects.error !== null) {
    fail("media object teardown", objects.error.message);
  }
}
