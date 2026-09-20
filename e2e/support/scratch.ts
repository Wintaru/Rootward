import { SCRATCH_SURNAME } from "./fixture-data";
import { ONE_PIXEL_PNG } from "./png";
import { admin } from "./supabase-admin";

export type ScratchPersons = {
  /** Inserts a person and returns its id. */
  readonly create: (
    givenName: string,
    sex?: "male" | "female" | "unknown",
  ) => Promise<string>;
  /** Deletes everything `create` made. Safe to call twice. */
  readonly remove: () => Promise<void>;
};

/**
 * Throwaway people for tests that write.
 *
 * Every control in the edit view saves to a real row, so a test that clicks
 * one needs a person it owns outright. Sharing a fixture person instead let
 * two parallel workers overwrite each other mid-assertion, and a leftover
 * edit changes the rendered name that other specs match on.
 *
 * They carry `SCRATCH_SURNAME`, not the fixture family's: the app's searches
 * are capped and sorted by surname, so sharing one surname pushed the fixture
 * people out of the results other specs assert on. The teardown sweeps this
 * surname too, so a row leaked by a failed test is still cleaned up even
 * though this helper's own `remove` never ran.
 */
/**
 * Deletes every family the given people are a partner in.
 *
 * Exported because a test that creates people through the UI (the
 * relationships editor's "create a new person" path) never learns their ids
 * from {@link scratchPersons} and has to sweep them itself.
 */
export async function removeEmptiedFamilies(
  personIds: readonly string[],
): Promise<void> {
  if (personIds.length === 0) {
    return;
  }
  const ids = personIds.join(",");
  const families = await admin
    .from("family")
    .select("id")
    .or(`partner1_id.in.(${ids}),partner2_id.in.(${ids})`);
  if (families.error !== null) {
    throw new Error(`family read failed: ${families.error.message}`);
  }
  const familyIds = (families.data ?? []).map((row) => row.id);
  if (familyIds.length === 0) {
    return;
  }
  const { error } = await admin.from("family").delete().in("id", familyIds);
  if (error !== null) {
    throw new Error(`family delete failed: ${error.message}`);
  }
}

export function scratchPersons(): ScratchPersons {
  const ids: string[] = [];

  return {
    async create(givenName, sex = "unknown") {
      const id = crypto.randomUUID();
      const { error } = await admin.from("person").insert({
        id,
        given_name: givenName,
        surname: SCRATCH_SURNAME,
        sex,
        visibility: "everyone_approved",
      });
      if (error !== null) {
        throw new Error(`scratch person insert failed: ${error.message}`);
      }
      ids.push(id);
      return id;
    },

    async remove() {
      if (ids.length === 0) {
        return;
      }
      const doomed = [...ids];
      ids.length = 0;
      // Families first: `family.partner1_id` / `partner2_id` are
      // `on delete set null`, so deleting a partner leaves the union behind
      // as a shell with no partners and no children rather than removing it.
      await removeEmptiedFamilies(doomed);

      // PostgREST does not treat "deleted nothing" as an error, so a row a
      // failing test already removed is fine. A real error throws, or the
      // next run inherits the mess.
      const { error } = await admin.from("person").delete().in("id", doomed);
      if (error !== null) {
        throw new Error(`scratch person delete failed: ${error.message}`);
      }
    },
  };
}

export type ScratchMedia = {
  /** Uploads a 1×1 PNG, creates the `media` row, and links it to `personId`. */
  readonly attach: (
    personId: string,
    options?: {
      readonly caption?: string;
      readonly isPrimary?: boolean;
      /** PNG bytes to store, when a test needs a real, measurable image
       * rather than the default single pixel. */
      readonly image?: Uint8Array;
    },
  ) => Promise<string>;
  /** Deletes every row and object `attach` made. Safe to call twice. */
  readonly remove: () => Promise<void>;
};

/**
 * Throwaway media for the Media section's caption / reorder / primary /
 * delete controls, which all need rows that already exist.
 *
 * Seeded through the service role rather than the upload control on
 * purpose: the upload path runs the `media-process` edge function, and a
 * stack that cannot boot it would otherwise take every one of those tests
 * down with it. The upload control has its own test, skipped when the
 * function is unreachable.
 */
export function scratchMedia(): ScratchMedia {
  const ids: string[] = [];

  return {
    async attach(personId, options = {}) {
      const bytes = options.image ?? ONE_PIXEL_PNG;
      const mediaId = crypto.randomUUID();
      const paths = {
        original: `${mediaId}/original.png`,
        thumb: `${mediaId}/thumb.png`,
        display: `${mediaId}/display.png`,
      };

      for (const path of Object.values(paths)) {
        const { error } = await admin.storage
          .from("media")
          .upload(path, bytes, {
            contentType: "image/png",
            upsert: true,
          });
        if (error !== null) {
          throw new Error(`scratch media upload failed: ${error.message}`);
        }
      }

      const row = await admin.from("media").insert({
        id: mediaId,
        original_filename: "scratch.png",
        mime_type: "image/png",
        size_bytes: bytes.byteLength,
        storage_path_original: paths.original,
        storage_path_thumb: paths.thumb,
        storage_path_display: paths.display,
        title: `Scratch ${mediaId.slice(0, 8)}`,
      });
      if (row.error !== null) {
        throw new Error(`scratch media row failed: ${row.error.message}`);
      }

      // `sort_order` is set explicitly so a freshly seeded row is already
      // at its own index. Left null, the Media section reads the section as
      // dirty the moment it loads — which is a real defect in the upload
      // path (`media-process` never sets it), covered by its own regression
      // test rather than quietly broken into every test here.
      const existing = await admin
        .from("media_link")
        .select("id", { count: "exact", head: true })
        .eq("owner_type", "person")
        .eq("owner_id", personId);
      if (existing.error !== null) {
        throw new Error(
          `scratch media count failed: ${existing.error.message}`,
        );
      }

      const link = await admin.from("media_link").insert({
        media_id: mediaId,
        owner_type: "person",
        owner_id: personId,
        is_primary: options.isPrimary ?? false,
        caption: options.caption ?? null,
        sort_order: existing.count ?? 0,
      });
      if (link.error !== null) {
        throw new Error(`scratch media link failed: ${link.error.message}`);
      }

      ids.push(mediaId);
      return mediaId;
    },

    async remove() {
      if (ids.length === 0) {
        return;
      }
      const doomed = [...ids];
      ids.length = 0;

      // Read the paths off the rows rather than rebuilding the seeded names:
      // saving a rotate or crop repoints `storage_path_thumb` / `_display`
      // at a token-suffixed object, so the originals are no longer what the
      // row holds (`lib/db/media-transform.ts`).
      const rows = await admin
        .from("media")
        .select(
          "storage_path_original, storage_path_thumb, storage_path_display",
        )
        .in("id", doomed);
      if (rows.error !== null) {
        throw new Error(`scratch media read failed: ${rows.error.message}`);
      }
      const paths = (rows.data ?? [])
        .flatMap((row) => [
          row.storage_path_original,
          row.storage_path_thumb,
          row.storage_path_display,
        ])
        .filter((path): path is string => path !== null);
      if (paths.length > 0) {
        const removed = await admin.storage.from("media").remove(paths);
        if (removed.error !== null) {
          throw new Error(
            `scratch media object delete failed: ${removed.error.message}`,
          );
        }
      }

      const unlinked = await admin
        .from("media_link")
        .delete()
        .in("media_id", doomed);
      if (unlinked.error !== null) {
        throw new Error(
          `scratch media link delete failed: ${unlinked.error.message}`,
        );
      }
      const { error } = await admin.from("media").delete().in("id", doomed);
      if (error !== null) {
        throw new Error(`scratch media delete failed: ${error.message}`);
      }
    },
  };
}
