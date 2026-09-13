import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { personSearchLabel } from "./person-search";
import { createPerson } from "./person-create";
import type { ChildRelation, PartnerRole, Sex, UnionType } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The write side of the edit view's Relationships section (SPEC §8.3, §4.2,
 * WAYFINDER decision 36, issue #56) — add parent, add partner, add child,
 * remove from family, plus editing what the schema already carries:
 * `family.relationship_type`, per-parent `child_relation`, child
 * `sort_order`, and partner roles.
 *
 * Unlike the flat single-table sections (`event-edit.ts`, `person-edit.ts`),
 * a relationship change touches `family` and `family_child` together and
 * sometimes creates or deletes a `family` row as a side effect — there is no
 * single row whose diff this fits. So this module departs from the
 * dirty-draft-then-Save pattern: each write below is an immediate,
 * version-checked action (WAYFINDER decision 26 still applies — every
 * UPDATE/DELETE is `WHERE id = $1 AND updated_at = $2`), and the client
 * (`RelationshipsSection.tsx`) calls `router.refresh()` on success rather
 * than reconciling local state — the same pattern `ExportPanel.tsx` uses for
 * its own multi-entity flow. A lost version check is reported as a plain
 * "changed elsewhere, reload" error, not the shared `ConflictDialog`, which
 * is built for a batch of comparable field diffs on one row, not an
 * add/remove action across a small graph of rows. Neither `family` nor
 * `family_child` carries `updated_by` (`lib/db/conflict.ts`), so there is
 * nothing to attribute a conflict to even if this did use `RowConflict`.
 *
 * Multi-step writes here (create a family then link a child, resolve a new
 * person then link it) are not transactional, the same accepted gap as
 * `saveAdditionalNames` — see that module's doc comment for why this is not
 * worth an RPC for v1.
 */

// --- read: everything the section needs ---------------------------------

export interface FamilyEditPartner {
  readonly id: string;
  readonly name: string;
  readonly role: PartnerRole | null;
}

export interface FamilyChildEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly personId: string;
  readonly personName: string;
  readonly relationToPartner1: ChildRelation | null;
  readonly relationToPartner2: ChildRelation | null;
  readonly sortOrder: number | null;
}

/** One family `personId` is a child in. A person has at most one of these in
 * this UI — see {@link addParent}'s doc comment. */
export interface ParentFamilyEditRow {
  readonly familyId: string;
  readonly familyUpdatedAt: string;
  readonly familyChildId: string;
  readonly familyChildUpdatedAt: string;
  readonly partner1: FamilyEditPartner | null;
  readonly partner2: FamilyEditPartner | null;
  readonly relationToPartner1: ChildRelation | null;
  readonly relationToPartner2: ChildRelation | null;
}

/** One family `personId` is a partner in — a union — without its children.
 * Everything the Events section needs to group family events under a "Union
 * with <partner>" heading (SPEC §8.3, issue #57); the Relationships section's
 * {@link UnionFamilyEditRow} adds `children` on top for its own fuller view. */
export interface UnionFamilySummary {
  readonly familyId: string;
  readonly familyUpdatedAt: string;
  readonly partner1: FamilyEditPartner | null;
  readonly partner2: FamilyEditPartner | null;
  readonly relationshipType: UnionType | null;
}

/** One family `personId` is a partner in — a union, with its children. */
export interface UnionFamilyEditRow extends UnionFamilySummary {
  readonly children: readonly FamilyChildEditRow[];
}

export interface RelationshipsEditData {
  readonly parentFamilies: readonly ParentFamilyEditRow[];
  readonly unionFamilies: readonly UnionFamilyEditRow[];
}

type PersonNameCols = {
  given_name: string | null;
  surname: string | null;
  nickname: string | null;
};

function toPartner(
  id: string | null,
  role: PartnerRole | null,
  person: PersonNameCols | null,
): FamilyEditPartner | null {
  if (id === null || person === null) {
    return null;
  }
  return { id, name: personSearchLabel(person), role };
}

// PostgREST needs the FK column named explicitly (not just the target table)
// to disambiguate the two `family → person` relationships — same reason
// `moderation.ts`'s `access_request` embed names its FK constraint.
const PARTNER_EMBED_COLUMNS =
  "partner1:person!family_partner1_id_fkey(given_name,surname,nickname)," +
  "partner2:person!family_partner2_id_fkey(given_name,surname,nickname)";

const PARENT_FAMILY_COLUMNS =
  `id, updated_at, relation_to_partner1, relation_to_partner2, ` +
  `family:family_id(id, updated_at, partner1_id, partner2_id, partner1_role, partner2_role, ${PARTNER_EMBED_COLUMNS})`;

type ParentFamilyDbRow = {
  id: string;
  updated_at: string;
  relation_to_partner1: ChildRelation | null;
  relation_to_partner2: ChildRelation | null;
  family: {
    id: string;
    updated_at: string;
    partner1_id: string | null;
    partner2_id: string | null;
    partner1_role: PartnerRole | null;
    partner2_role: PartnerRole | null;
    partner1: PersonNameCols | null;
    partner2: PersonNameCols | null;
  } | null;
};

const UNION_FAMILY_COLUMNS = `id, updated_at, partner1_id, partner2_id, partner1_role, partner2_role, relationship_type, ${PARTNER_EMBED_COLUMNS}`;

type UnionFamilyDbRow = {
  id: string;
  updated_at: string;
  partner1_id: string | null;
  partner2_id: string | null;
  partner1_role: PartnerRole | null;
  partner2_role: PartnerRole | null;
  relationship_type: UnionType | null;
  partner1: PersonNameCols | null;
  partner2: PersonNameCols | null;
};

const FAMILY_CHILD_COLUMNS =
  "id, family_id, person_id, updated_at, relation_to_partner1, relation_to_partner2, sort_order, person:person_id(given_name,surname,nickname)";

type FamilyChildDbRow = {
  id: string;
  family_id: string;
  person_id: string;
  updated_at: string;
  relation_to_partner1: ChildRelation | null;
  relation_to_partner2: ChildRelation | null;
  sort_order: number | null;
  person: PersonNameCols | null;
};

function mapFamilyChild(row: FamilyChildDbRow): FamilyChildEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    personId: row.person_id,
    personName: personSearchLabel(
      row.person ?? { given_name: null, surname: null, nickname: null },
    ),
    relationToPartner1: row.relation_to_partner1,
    relationToPartner2: row.relation_to_partner2,
    sortOrder: row.sort_order,
  };
}

/** The union families `personId` partners in, without their children — see
 * {@link UnionFamilySummary}'s doc for why this is split out from
 * {@link getRelationshipsEditData}. */
export async function getUnionFamilySummaries(
  client: Db,
  personId: string,
): Promise<readonly UnionFamilySummary[]> {
  const { data, error } = await client
    .from("family")
    .select(UNION_FAMILY_COLUMNS)
    .or(`partner1_id.eq.${personId},partner2_id.eq.${personId}`)
    .order("created_at", { ascending: true });

  if (error !== null) {
    throw new Error(`getUnionFamilySummaries: ${error.message}`);
  }

  return (data as unknown as UnionFamilyDbRow[]).map((row) => ({
    familyId: row.id,
    familyUpdatedAt: row.updated_at,
    partner1: toPartner(row.partner1_id, row.partner1_role, row.partner1),
    partner2: toPartner(row.partner2_id, row.partner2_role, row.partner2),
    relationshipType: row.relationship_type,
  }));
}

/** Every family `personId` is a child in or a partner in, with each union's
 * children — everything the Relationships section shows (SPEC §8.3, issue
 * #56). Three round trips: parent families (with their partners embedded),
 * union families (with their partners embedded, via
 * {@link getUnionFamilySummaries}), then every child of every union family in
 * one batched fetch — genealogy-sized data, not worth collapsing further.
 * Runs under the caller's identity; RLS (`family_select` / `family_child_select`)
 * is the boundary, same as every other section's read. */
export async function getRelationshipsEditData(
  client: Db,
  personId: string,
): Promise<RelationshipsEditData> {
  const [parentRes, unionFamilySummaries] = await Promise.all([
    client
      .from("family_child")
      .select(PARENT_FAMILY_COLUMNS)
      .eq("person_id", personId)
      .order("created_at", { ascending: true }),
    getUnionFamilySummaries(client, personId),
  ]);

  if (parentRes.error !== null) {
    throw new Error(
      `getRelationshipsEditData: parent families: ${parentRes.error.message}`,
    );
  }

  const parentFamilies: ParentFamilyEditRow[] = (
    parentRes.data as unknown as ParentFamilyDbRow[]
  )
    .filter(
      (
        row,
      ): row is ParentFamilyDbRow & {
        family: NonNullable<ParentFamilyDbRow["family"]>;
      } => row.family !== null,
    )
    .map((row) => ({
      familyId: row.family.id,
      familyUpdatedAt: row.family.updated_at,
      familyChildId: row.id,
      familyChildUpdatedAt: row.updated_at,
      partner1: toPartner(
        row.family.partner1_id,
        row.family.partner1_role,
        row.family.partner1,
      ),
      partner2: toPartner(
        row.family.partner2_id,
        row.family.partner2_role,
        row.family.partner2,
      ),
      relationToPartner1: row.relation_to_partner1,
      relationToPartner2: row.relation_to_partner2,
    }));

  const unionFamilyIds = unionFamilySummaries.map((row) => row.familyId);

  const childrenByFamily = new Map<string, FamilyChildEditRow[]>();
  if (unionFamilyIds.length > 0) {
    const childRes = await client
      .from("family_child")
      .select(FAMILY_CHILD_COLUMNS)
      .in("family_id", unionFamilyIds)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (childRes.error !== null) {
      throw new Error(
        `getRelationshipsEditData: children: ${childRes.error.message}`,
      );
    }
    for (const row of childRes.data as unknown as FamilyChildDbRow[]) {
      const list = childrenByFamily.get(row.family_id) ?? [];
      list.push(mapFamilyChild(row));
      childrenByFamily.set(row.family_id, list);
    }
  }

  const unionFamilies: UnionFamilyEditRow[] = unionFamilySummaries.map(
    (summary) => ({
      ...summary,
      children: childrenByFamily.get(summary.familyId) ?? [],
    }),
  );

  return { parentFamilies, unionFamilies };
}

// --- person reference (existing, or a new person to create) --------------

export type PersonRef =
  | { readonly kind: "existing"; readonly personId: string }
  | {
      readonly kind: "new";
      readonly givenName: string | null;
      readonly surname: string | null;
      readonly sex: Sex;
    };

async function resolvePersonRef(client: Db, ref: PersonRef): Promise<string> {
  if (ref.kind === "existing") {
    return ref.personId;
  }
  return createPerson(client, {
    givenName: ref.givenName,
    surname: ref.surname,
    sex: ref.sex,
  });
}

/** `resolvePersonRef` for a `kind: "new"` ref creates the person before the
 * version-checked write that links them in ever runs — a real family-edit
 * table row, not a draft, since `person_insert` has no concept of "pending".
 * If that write then loses its version check (or, for `addParent`, finds no
 * empty slot to fill), call this to delete the just-created person rather
 * than leave an unlinked "ghost" — there is no delete-person UI yet (#59)
 * for a moderator to clean one up by hand, and retrying from
 * `PersonPickerOrCreate` would otherwise create a second one. A no-op for an
 * `existing` ref, which never created anything. */
async function compensateIfNewPerson(
  client: Db,
  ref: PersonRef,
  personId: string,
): Promise<void> {
  if (ref.kind !== "new") {
    return;
  }
  const { error } = await client.from("person").delete().eq("id", personId);
  if (error !== null) {
    throw new Error(`compensateIfNewPerson: ${error.message}`);
  }
}

export type FamilyWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "conflict" }
  | { readonly ok: false; readonly reason: "no-empty-slot" };

// --- deleting an emptied family -------------------------------------------

/** Removing the last member of a family deletes the family row (WAYFINDER
 * decision 36). `event`/`fact` cascade on `family_id`
 * (`events_facts_places.sql`), so this also removes the family's own union
 * events (marriage, divorce, …) — no extra cleanup needed here.
 *
 * `partner1Id`/`partner2Id` are a snapshot from the write that just ran, used
 * only to skip the round trip below in the common case (a family with a
 * partner still set). The DELETE itself re-checks both slots are still null
 * at delete time (`.is("partner1_id", null).is("partner2_id", null)`) rather
 * than trusting that snapshot, so a partner another moderator fills in
 * between the snapshot and this call is not deleted out from under them. */
async function deleteFamilyIfEmpty(
  client: Db,
  familyId: string,
  partner1Id: string | null,
  partner2Id: string | null,
): Promise<void> {
  if (partner1Id !== null || partner2Id !== null) {
    return;
  }
  const remaining = await client
    .from("family_child")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId);
  if (remaining.error !== null) {
    throw new Error(`deleteFamilyIfEmpty: ${remaining.error.message}`);
  }
  if ((remaining.count ?? 0) > 0) {
    return;
  }
  const { error } = await client
    .from("family")
    .delete()
    .eq("id", familyId)
    .is("partner1_id", null)
    .is("partner2_id", null);
  if (error !== null) {
    throw new Error(`deleteFamilyIfEmpty: delete: ${error.message}`);
  }
}

// --- parents ---------------------------------------------------------------

/**
 * Add a parent to `childPersonId`. A person has at most one parents-family in
 * this UI (WAYFINDER decision 36 — "a single known parent is a family with
 * one partner null; a later add parent fills that slot, not a second
 * family"): with none yet, this creates one; with one that still has an
 * empty slot, this fills it. `RelationshipsSection.tsx` only ever shows the
 * "Add parent" control in one of those two states, so `no-empty-slot` here
 * is defensive, not a real UI path.
 */
export async function addParent(
  client: Db,
  args: {
    readonly childPersonId: string;
    readonly parent: PersonRef;
    readonly role: PartnerRole;
  },
): Promise<FamilyWriteResult> {
  const existing = await client
    .from("family_child")
    .select("family:family_id(id, updated_at, partner1_id, partner2_id)")
    .eq("person_id", args.childPersonId)
    .limit(1)
    .maybeSingle();

  if (existing.error !== null) {
    throw new Error(`addParent: read: ${existing.error.message}`);
  }

  const family = existing.data?.family as
    | {
        id: string;
        updated_at: string;
        partner1_id: string | null;
        partner2_id: string | null;
      }
    | null
    | undefined;

  const parentPersonId = await resolvePersonRef(client, args.parent);

  if (family === null || family === undefined) {
    const familyIns = await client
      .from("family")
      .insert({ partner1_id: parentPersonId, partner1_role: args.role })
      .select("id")
      .single();
    if (familyIns.error !== null) {
      throw new Error(`addParent: create family: ${familyIns.error.message}`);
    }
    const childIns = await client
      .from("family_child")
      .insert({ family_id: familyIns.data.id, person_id: args.childPersonId });
    if (childIns.error !== null) {
      throw new Error(`addParent: link child: ${childIns.error.message}`);
    }
    return { ok: true };
  }

  const slot =
    family.partner1_id === null
      ? "partner1"
      : family.partner2_id === null
        ? "partner2"
        : null;
  if (slot === null) {
    await compensateIfNewPerson(client, args.parent, parentPersonId);
    return { ok: false, reason: "no-empty-slot" };
  }

  const patch =
    slot === "partner1"
      ? { partner1_id: parentPersonId, partner1_role: args.role }
      : { partner2_id: parentPersonId, partner2_role: args.role };

  const { data, error } = await client
    .from("family")
    .update(patch)
    .eq("id", family.id)
    .eq("updated_at", family.updated_at)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`addParent: fill slot: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true };
  }
  await compensateIfNewPerson(client, args.parent, parentPersonId);
  return { ok: false, reason: "conflict" };
}

// --- partners ---------------------------------------------------------------

/** Always creates a brand-new union family with `focusPersonId` as
 * `partner1` — genealogically ordinary (remarriage, multiple partners), so
 * unlike {@link addParent} this never tries to reuse an existing family's
 * empty slot. Filling a *specific* existing family's empty slot (e.g. a
 * single-parent family with a partner later identified) is
 * {@link fillFamilyPartnerSlot}, invoked from that family's own row. */
export async function addPartner(
  client: Db,
  args: {
    readonly focusPersonId: string;
    readonly focusRole: PartnerRole;
    readonly partner: PersonRef;
    readonly partnerRole: PartnerRole;
    readonly relationshipType: UnionType | null;
  },
): Promise<FamilyWriteResult> {
  const partnerPersonId = await resolvePersonRef(client, args.partner);
  const { error } = await client.from("family").insert({
    partner1_id: args.focusPersonId,
    partner1_role: args.focusRole,
    partner2_id: partnerPersonId,
    partner2_role: args.partnerRole,
    relationship_type: args.relationshipType,
  });
  if (error !== null) {
    throw new Error(`addPartner: ${error.message}`);
  }
  return { ok: true };
}

/** Fill one specific family's empty partner slot — see {@link addPartner}'s
 * doc comment for when this applies instead of creating a new union. */
export async function fillFamilyPartnerSlot(
  client: Db,
  args: {
    readonly familyId: string;
    readonly expectedUpdatedAt: string;
    readonly slot: "partner1" | "partner2";
    readonly partner: PersonRef;
    readonly role: PartnerRole;
  },
): Promise<FamilyWriteResult> {
  const partnerPersonId = await resolvePersonRef(client, args.partner);
  const patch =
    args.slot === "partner1"
      ? { partner1_id: partnerPersonId, partner1_role: args.role }
      : { partner2_id: partnerPersonId, partner2_role: args.role };

  const { data, error } = await client
    .from("family")
    .update(patch)
    .eq("id", args.familyId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`fillFamilyPartnerSlot: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true };
  }
  await compensateIfNewPerson(client, args.partner, partnerPersonId);
  return { ok: false, reason: "conflict" };
}

/** Clear one partner slot — "remove from family" applied to a partner
 * (WAYFINDER decision 36). Deletes the family too if this empties it. */
export async function removePartnerFromFamily(
  client: Db,
  args: {
    readonly familyId: string;
    readonly expectedUpdatedAt: string;
    readonly slot: "partner1" | "partner2";
  },
): Promise<FamilyWriteResult> {
  const patch =
    args.slot === "partner1"
      ? { partner1_id: null, partner1_role: null }
      : { partner2_id: null, partner2_role: null };

  const { data, error } = await client
    .from("family")
    .update(patch)
    .eq("id", args.familyId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("id, partner1_id, partner2_id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`removePartnerFromFamily: ${error.message}`);
  }
  if (data === null) {
    return { ok: false, reason: "conflict" };
  }
  await deleteFamilyIfEmpty(
    client,
    data.id,
    data.partner1_id,
    data.partner2_id,
  );
  return { ok: true };
}

export async function updateFamilyRelationshipType(
  client: Db,
  args: {
    readonly familyId: string;
    readonly expectedUpdatedAt: string;
    readonly relationshipType: UnionType | null;
  },
): Promise<FamilyWriteResult> {
  const { data, error } = await client
    .from("family")
    .update({ relationship_type: args.relationshipType })
    .eq("id", args.familyId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error !== null) {
    throw new Error(`updateFamilyRelationshipType: ${error.message}`);
  }
  return data !== null ? { ok: true } : { ok: false, reason: "conflict" };
}

export async function updatePartnerRole(
  client: Db,
  args: {
    readonly familyId: string;
    readonly expectedUpdatedAt: string;
    readonly slot: "partner1" | "partner2";
    readonly role: PartnerRole | null;
  },
): Promise<FamilyWriteResult> {
  const patch =
    args.slot === "partner1"
      ? { partner1_role: args.role }
      : { partner2_role: args.role };
  const { data, error } = await client
    .from("family")
    .update(patch)
    .eq("id", args.familyId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error !== null) {
    throw new Error(`updatePartnerRole: ${error.message}`);
  }
  return data !== null ? { ok: true } : { ok: false, reason: "conflict" };
}

// --- children ---------------------------------------------------------------

/** Add a child to a union family the caller is already a partner in.
 * `sortOrder` is the family's current child count — a small, accepted race
 * with a concurrent add, same posture as `findOrCreatePlaceId`'s retry (not
 * worth guarding a reorder-only field two moderators are unlikely to collide
 * on at the exact same moment). */
export async function addChildToFamily(
  client: Db,
  args: { readonly familyId: string; readonly child: PersonRef },
): Promise<FamilyWriteResult> {
  const childPersonId = await resolvePersonRef(client, args.child);

  const count = await client
    .from("family_child")
    .select("id", { count: "exact", head: true })
    .eq("family_id", args.familyId);
  if (count.error !== null) {
    throw new Error(`addChildToFamily: count: ${count.error.message}`);
  }

  const { error } = await client.from("family_child").insert({
    family_id: args.familyId,
    person_id: childPersonId,
    sort_order: count.count ?? 0,
  });
  if (error !== null) {
    throw new Error(`addChildToFamily: ${error.message}`);
  }
  return { ok: true };
}

/** Remove a `family_child` row — "remove from family" applied to a child
 * (WAYFINDER decision 36), whether that child is the focus person themselves
 * (leaving a parents-family) or one of the focus's own children (leaving a
 * union family). Deletes the family too if this empties it. */
export async function removeFamilyChild(
  client: Db,
  args: { readonly familyChildId: string; readonly expectedUpdatedAt: string },
): Promise<FamilyWriteResult> {
  const { data, error } = await client
    .from("family_child")
    .delete()
    .eq("id", args.familyChildId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("family_id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`removeFamilyChild: ${error.message}`);
  }
  if (data === null) {
    return { ok: false, reason: "conflict" };
  }

  const family = await client
    .from("family")
    .select("id, partner1_id, partner2_id")
    .eq("id", data.family_id)
    .maybeSingle();
  if (family.error !== null) {
    throw new Error(
      `removeFamilyChild: reload family: ${family.error.message}`,
    );
  }
  if (family.data !== null) {
    await deleteFamilyIfEmpty(
      client,
      family.data.id,
      family.data.partner1_id,
      family.data.partner2_id,
    );
  }
  return { ok: true };
}

export async function updateFamilyChildRelation(
  client: Db,
  args: {
    readonly familyChildId: string;
    readonly expectedUpdatedAt: string;
    readonly slot: "partner1" | "partner2";
    readonly relation: ChildRelation | null;
  },
): Promise<FamilyWriteResult> {
  const patch =
    args.slot === "partner1"
      ? { relation_to_partner1: args.relation }
      : { relation_to_partner2: args.relation };
  const { data, error } = await client
    .from("family_child")
    .update(patch)
    .eq("id", args.familyChildId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error !== null) {
    throw new Error(`updateFamilyChildRelation: ${error.message}`);
  }
  return data !== null ? { ok: true } : { ok: false, reason: "conflict" };
}

/** Reorder a union family's children — each row is its own version-checked
 * update (decision 26), same one-round-trip-per-row shape as
 * `saveAdditionalNames`'s `sortOrder` diff, run concurrently rather than
 * sequentially. A conflict on one row does not roll back a sibling row's
 * update that already landed — Postgres has no cross-row transaction here —
 * so this can return `{ok: false, reason: "conflict"}` for a reorder that
 * partially applied. That is why `RelationshipsSection.tsx`'s
 * `useFamilyAction` always re-fetches after calling this (win or lose):
 * whatever did or didn't land, the refreshed `sort_order`s are the truth to
 * show, not the client's pre-reorder assumption. */
export async function reorderFamilyChildren(
  client: Db,
  updates: readonly {
    readonly id: string;
    readonly expectedUpdatedAt: string;
    readonly sortOrder: number;
  }[],
): Promise<FamilyWriteResult> {
  const results = await Promise.all(
    updates.map((update) =>
      client
        .from("family_child")
        .update({ sort_order: update.sortOrder })
        .eq("id", update.id)
        .eq("updated_at", update.expectedUpdatedAt)
        .select("id")
        .maybeSingle(),
    ),
  );
  for (const result of results) {
    if (result.error !== null) {
      throw new Error(`reorderFamilyChildren: ${result.error.message}`);
    }
    if (result.data === null) {
      return { ok: false, reason: "conflict" };
    }
  }
  return { ok: true };
}
