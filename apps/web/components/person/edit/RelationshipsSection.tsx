"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  addChildToFamilyAction,
  addParentAction,
  addPartnerAction,
  fillFamilyPartnerSlotAction,
  recordUnionEndAction,
  removeFamilyChildAction,
  removePartnerFromFamilyAction,
  reorderFamilyChildrenAction,
  searchRelationshipPersons,
  updateFamilyChildRelationAction,
  updateFamilyRelationshipTypeAction,
  updatePartnerRoleAction,
  type RelationshipActionResult,
} from "@/app/person/[personId]/edit/actions";
import { Constants } from "@/lib/db";
import type {
  FamilyChildEditRow,
  FamilyEditPartner,
  ParentFamilyEditRow,
  RelationshipsEditData,
  UnionFamilyEditRow,
} from "@/lib/db/family-edit";
import type {
  ChildRelation,
  PartnerRole,
  Sex,
  UnionType,
} from "@/lib/db/types";
import { defaultPartnerRoleForSex } from "@/lib/edit/relationships";
import { editSectionHref } from "@/lib/edit/sections";
import { unionStatusLine } from "@/lib/edit/union-status";
import {
  childRelationLabel,
  enumTokenLabel,
  partnerRoleLabel,
} from "@/lib/person/labels";

import { DateInput } from "./DateInput";
import { PersonPickerOrCreate } from "./PersonPickerOrCreate";

/**
 * Relationships (SPEC §8.3, WAYFINDER decision 36, issue #56) — add parent,
 * add partner, add child, remove from family, plus editing what the schema
 * already carries: `family.relationship_type`, per-parent `child_relation`,
 * child `sort_order`, and partner roles.
 *
 * Structurally unlike every other section here: a relationship change spans
 * `family` and `family_child` together and sometimes creates or deletes a
 * `family` row, so there is no single row's diff to batch into one Save.
 * Each action below is immediate (version-checked per WAYFINDER decision 26,
 * but no dirty-draft/Save step) and, on success, calls `router.refresh()` to
 * re-fetch `RelationshipsEditData` from the server rather than reconciling
 * local state — see `lib/db/family-edit.ts`'s module doc for the full
 * rationale, and `ExportPanel.tsx` for the same refresh-driven pattern used
 * elsewhere in this app.
 */
export function RelationshipsSection({
  personId,
  personSex,
  loaded,
}: {
  readonly personId: string;
  readonly personSex: Sex | null;
  readonly loaded: RelationshipsEditData;
}) {
  return (
    <div className="flex flex-col gap-8">
      <ParentsPanel
        personId={personId}
        parentFamilies={loaded.parentFamilies}
      />
      <UnionsPanel
        personId={personId}
        personSex={personSex}
        unionFamilies={loaded.unionFamilies}
      />
    </div>
  );
}

// --- shared: run an action, refresh on success ---------------------------

function useFamilyAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<RelationshipActionResult>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result.status === "ok") {
        router.refresh();
        return;
      }
      if (result.status === "conflict") {
        setError("This changed elsewhere. Reload the page and try again.");
        // A conflict can still mean part of a multi-row write landed (e.g. a
        // reorder where one sibling row's update committed before another
        // lost its version check — see `reorderFamilyChildren`'s doc
        // comment) — refresh so the view reflects whatever the server
        // actually holds now, not this component's pre-write assumption.
        router.refresh();
      } else if (result.status === "no-empty-slot") {
        setError("This family already has two parents.");
        router.refresh();
      } else {
        setError(result.message);
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}

function ActionError({ message }: { readonly message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p className="text-destructive text-xs" role="alert">
      {message}
    </p>
  );
}

const smallButton =
  "border-border hover:bg-accent w-fit rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50";
const removeButton =
  "text-destructive w-fit rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40";
const selectClass = "border-border rounded-md border px-2 py-1 text-xs";

/** Both selects below sit beside their description as plain text ("Relation
 * to child:", "to Vera:") with nothing that associates it, so each takes an
 * explicit `label` for its accessible name — naming the person too, so a
 * screen reader can tell several otherwise identical comboboxes apart
 * (#118). Keep the visible phrase inside the name verbatim: a voice-control
 * user speaks what they see (WCAG 2.5.3). */
function PartnerRoleSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: PartnerRole | null;
  readonly disabled: boolean;
  readonly onChange: (value: PartnerRole) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => {
        if (isPartnerRole(e.target.value)) {
          onChange(e.target.value);
        }
      }}
      className={selectClass}
    >
      <option value="" disabled>
        Role…
      </option>
      {Constants.public.Enums.partner_role.map((role) => (
        <option key={role} value={role}>
          {partnerRoleLabel(role)}
        </option>
      ))}
    </select>
  );
}

function isPartnerRole(value: string): value is PartnerRole {
  return (Constants.public.Enums.partner_role as readonly string[]).includes(
    value,
  );
}

function ChildRelationSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: ChildRelation | null;
  readonly disabled: boolean;
  readonly onChange: (value: ChildRelation | null) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) =>
        onChange(isChildRelation(e.target.value) ? e.target.value : null)
      }
      className={selectClass}
    >
      <option value="">Unspecified</option>
      {Constants.public.Enums.child_relation.map((relation) => (
        <option key={relation} value={relation}>
          {childRelationLabel(relation)}
        </option>
      ))}
    </select>
  );
}

function isChildRelation(value: string): value is ChildRelation {
  return (Constants.public.Enums.child_relation as readonly string[]).includes(
    value,
  );
}

function PartnerLine({ partner }: { readonly partner: FamilyEditPartner }) {
  return (
    <span className="text-sm font-medium">
      {partner.name}
      {partner.role !== null && partner.role !== "unknown" && (
        <span className="text-muted-foreground">
          {" "}
          · {partnerRoleLabel(partner.role)}
        </span>
      )}
    </span>
  );
}

// --- parents ----------------------------------------------------------

function ParentsPanel({
  personId,
  parentFamilies,
}: {
  readonly personId: string;
  readonly parentFamilies: readonly ParentFamilyEditRow[];
}) {
  const [addingNew, setAddingNew] = useState(false);
  const { busy, error, run } = useFamilyAction();

  const hasEmptySlot = parentFamilies.some(
    (family) => family.partner1 === null || family.partner2 === null,
  );

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Parents</h3>

      {parentFamilies.length === 0 && !addingNew && (
        <p className="text-muted-foreground text-sm">No parents recorded.</p>
      )}

      {parentFamilies.map((family) => (
        <ParentFamilyCard
          key={family.familyId}
          personId={personId}
          family={family}
        />
      ))}

      {parentFamilies.length === 0 &&
        (addingNew ? (
          <PersonPickerOrCreate
            label="Add a parent"
            disabled={busy}
            search={searchRelationshipPersons}
            onResolved={(ref, sex) => {
              setAddingNew(false);
              void run(() =>
                addParentAction({
                  personId,
                  parent: ref,
                  role: defaultPartnerRoleForSex(sex),
                }),
              );
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className={smallButton}
          >
            Add a parent
          </button>
        ))}

      {parentFamilies.length > 0 && !hasEmptySlot && (
        <p className="text-muted-foreground text-xs">
          Both parents are set. Edit a parent&apos;s own record to add further
          relatives on their side.
        </p>
      )}

      <ActionError message={error} />
    </section>
  );
}

function ParentFamilyCard({
  personId,
  family,
}: {
  readonly personId: string;
  readonly family: ParentFamilyEditRow;
}) {
  const { busy, error, run } = useFamilyAction();
  const [fillingSlot, setFillingSlot] = useState<
    "partner1" | "partner2" | null
  >(null);

  function slotContent(
    slot: "partner1" | "partner2",
    partner: FamilyEditPartner | null,
    relation: ChildRelation | null,
  ) {
    if (partner === null) {
      return fillingSlot === slot ? (
        <PersonPickerOrCreate
          label="Add parent"
          disabled={busy}
          search={searchRelationshipPersons}
          onResolved={(ref, sex) => {
            setFillingSlot(null);
            void run(() =>
              addParentAction({
                personId,
                parent: ref,
                role: defaultPartnerRoleForSex(sex),
              }),
            );
          }}
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setFillingSlot(slot)}
          className={smallButton}
        >
          Add parent
        </button>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <PartnerLine partner={partner} />
        <span className="text-muted-foreground text-xs">
          Relation to child:
        </span>
        <ChildRelationSelect
          label={`${partner.name}: Relation to child`}
          value={relation}
          disabled={busy}
          onChange={(value) =>
            void run(() =>
              updateFamilyChildRelationAction({
                personId,
                familyChildId: family.familyChildId,
                expectedUpdatedAt: family.familyChildUpdatedAt,
                slot,
                relation: value,
              }),
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-lg border p-4">
      {slotContent("partner1", family.partner1, family.relationToPartner1)}
      {slotContent("partner2", family.partner2, family.relationToPartner2)}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(() =>
            removeFamilyChildAction({
              personId,
              familyChildId: family.familyChildId,
              expectedUpdatedAt: family.familyChildUpdatedAt,
            }),
          )
        }
        className={removeButton}
      >
        Remove from this family
      </button>
      <ActionError message={error} />
    </div>
  );
}

// --- partners & children ------------------------------------------------

function UnionsPanel({
  personId,
  personSex,
  unionFamilies,
}: {
  readonly personId: string;
  readonly personSex: Sex | null;
  readonly unionFamilies: readonly UnionFamilyEditRow[];
}) {
  const [addingNew, setAddingNew] = useState(false);
  const { busy, error, run } = useFamilyAction();

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Partners &amp; children</h3>

      {unionFamilies.length === 0 && !addingNew && (
        <p className="text-muted-foreground text-sm">No partners recorded.</p>
      )}

      {unionFamilies.map((family) => (
        <UnionFamilyCard
          key={family.familyId}
          personId={personId}
          family={family}
        />
      ))}

      {addingNew ? (
        <PersonPickerOrCreate
          label="Start a new union"
          disabled={busy}
          search={searchRelationshipPersons}
          onResolved={(ref, sex) => {
            setAddingNew(false);
            void run(() =>
              addPartnerAction({
                personId,
                focusRole: defaultPartnerRoleForSex(personSex),
                partner: ref,
                partnerRole: defaultPartnerRoleForSex(sex),
                relationshipType: null,
              }),
            );
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          className={smallButton}
        >
          Start a new union
        </button>
      )}

      <ActionError message={error} />
    </section>
  );
}

function UnionFamilyCard({
  personId,
  family,
}: {
  readonly personId: string;
  readonly family: UnionFamilyEditRow;
}) {
  const { busy, error, run } = useFamilyAction();
  const [fillingSlot, setFillingSlot] = useState<
    "partner1" | "partner2" | null
  >(null);
  const [addingChild, setAddingChild] = useState(false);
  const relationshipTypeId = useId();

  function partnerSlot(
    slot: "partner1" | "partner2",
    partner: FamilyEditPartner | null,
  ) {
    if (partner === null) {
      return fillingSlot === slot ? (
        <PersonPickerOrCreate
          label="Add partner"
          disabled={busy}
          search={searchRelationshipPersons}
          onResolved={(ref, sex) => {
            setFillingSlot(null);
            void run(() =>
              fillFamilyPartnerSlotAction({
                personId,
                familyId: family.familyId,
                expectedUpdatedAt: family.familyUpdatedAt,
                slot,
                partner: ref,
                role: defaultPartnerRoleForSex(sex),
              }),
            );
          }}
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setFillingSlot(slot)}
          className={smallButton}
        >
          Add partner
        </button>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <PartnerLine partner={partner} />
        <PartnerRoleSelect
          label={`Role of ${partner.name}`}
          value={partner.role}
          disabled={busy}
          onChange={(role) =>
            void run(() =>
              updatePartnerRoleAction({
                personId,
                familyId: family.familyId,
                expectedUpdatedAt: family.familyUpdatedAt,
                slot,
                role,
              }),
            )
          }
        />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              removePartnerFromFamilyAction({
                personId,
                familyId: family.familyId,
                expectedUpdatedAt: family.familyUpdatedAt,
                slot,
              }),
            )
          }
          className={removeButton}
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      {partnerSlot("partner1", family.partner1)}
      {partnerSlot("partner2", family.partner2)}

      <label
        htmlFor={relationshipTypeId}
        className="text-muted-foreground flex items-center gap-2 text-xs font-medium"
      >
        Union type
        <select
          id={relationshipTypeId}
          value={family.relationshipType ?? ""}
          disabled={busy}
          onChange={(e) =>
            void run(() =>
              updateFamilyRelationshipTypeAction({
                personId,
                familyId: family.familyId,
                expectedUpdatedAt: family.familyUpdatedAt,
                relationshipType: isUnionType(e.target.value)
                  ? e.target.value
                  : null,
              }),
            )
          }
          className={selectClass}
        >
          <option value="">Unspecified</option>
          {Constants.public.Enums.union_type.map((type) => (
            <option key={type} value={type}>
              {enumTokenLabel(type)}
            </option>
          ))}
        </select>
      </label>

      <UnionStatusPanel
        personId={personId}
        family={family}
        busy={busy}
        run={run}
      />

      <ChildrenList personId={personId} family={family} />

      {addingChild ? (
        <PersonPickerOrCreate
          label="Add a child"
          disabled={busy}
          search={searchRelationshipPersons}
          onResolved={(ref) => {
            setAddingChild(false);
            void run(() =>
              addChildToFamilyAction({
                personId,
                familyId: family.familyId,
                child: ref,
              }),
            );
          }}
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setAddingChild(true)}
          className={smallButton}
        >
          Add a child
        </button>
      )}

      <ActionError message={error} />
    </div>
  );
}

/**
 * The union's status line — "Married — 1990 · Divorced — 2003" — and the
 * "Record a divorce" shortcut (issue #122). The dates themselves are events
 * on the family, edited in full under Events; this card only reads them and
 * offers the one write people look for here, because a divorce buried under
 * Events alone is not where anyone expects to record it. Whether the union
 * has ended is `family.endedBy`, the server's call — the button hides once
 * it has, and the line links to Events for editing the dates.
 */
function UnionStatusPanel({
  personId,
  family,
  busy,
  run,
}: {
  readonly personId: string;
  readonly family: UnionFamilyEditRow;
  readonly busy: boolean;
  readonly run: (
    action: () => Promise<RelationshipActionResult>,
  ) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [dateRaw, setDateRaw] = useState("");
  const dateId = useId();
  const status = unionStatusLine(family);
  const canRecordEnd =
    family.endedBy === null &&
    family.partner1 !== null &&
    family.partner2 !== null;

  function submit() {
    setRecording(false);
    setDateRaw("");
    void run(() =>
      recordUnionEndAction({
        personId,
        familyId: family.familyId,
        endedBy: "divorce",
        dateRaw,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {[status.standing ?? "No union date recorded", status.ended]
          .filter((part): part is string => part !== null)
          .join(" · ")}
        {" · "}
        <Link
          href={editSectionHref(personId, "events")}
          className="underline underline-offset-2"
        >
          Edit dates in Events
        </Link>
      </p>

      {canRecordEnd &&
        (recording ? (
          <form
            className="border-border flex flex-col gap-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <DateInput
              id={dateId}
              label="Divorce date"
              value={dateRaw}
              disabled={busy}
              onChange={setDateRaw}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={smallButton}>
                Record divorce
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRecording(false);
                  setDateRaw("");
                }}
                className={smallButton}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setRecording(true)}
            className={smallButton}
          >
            Record a divorce
          </button>
        ))}
    </div>
  );
}

function ChildrenList({
  personId,
  family,
}: {
  readonly personId: string;
  readonly family: UnionFamilyEditRow;
}) {
  const { busy, error, run } = useFamilyAction();

  if (family.children.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No children recorded.</p>
    );
  }

  function move(child: FamilyChildEditRow, direction: "up" | "down") {
    const index = family.children.findIndex((c) => c.id === child.id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= family.children.length) {
      return;
    }
    const other = family.children[swapWith]!;
    void run(() =>
      reorderFamilyChildrenAction({
        personId,
        updates: [
          {
            id: child.id,
            expectedUpdatedAt: child.updatedAt,
            sortOrder: swapWith,
          },
          {
            id: other.id,
            expectedUpdatedAt: other.updatedAt,
            sortOrder: index,
          },
        ],
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {family.children.map((child, index) => (
          <li
            key={child.id}
            className="border-border flex flex-wrap items-center gap-2 rounded-md border p-2"
          >
            <span className="text-sm">{child.personName}</span>
            <span className="text-muted-foreground text-xs">
              to {family.partner1?.name ?? "partner 1"}:
            </span>
            <ChildRelationSelect
              label={`Relation of ${child.personName} to ${family.partner1?.name ?? "partner 1"}`}
              value={child.relationToPartner1}
              disabled={busy}
              onChange={(relation) =>
                void run(() =>
                  updateFamilyChildRelationAction({
                    personId,
                    familyChildId: child.id,
                    expectedUpdatedAt: child.updatedAt,
                    slot: "partner1",
                    relation,
                  }),
                )
              }
            />
            <span className="text-muted-foreground text-xs">
              to {family.partner2?.name ?? "partner 2"}:
            </span>
            <ChildRelationSelect
              label={`Relation of ${child.personName} to ${family.partner2?.name ?? "partner 2"}`}
              value={child.relationToPartner2}
              disabled={busy}
              onChange={(relation) =>
                void run(() =>
                  updateFamilyChildRelationAction({
                    personId,
                    familyChildId: child.id,
                    expectedUpdatedAt: child.updatedAt,
                    slot: "partner2",
                    relation,
                  }),
                )
              }
            />
            <button
              type="button"
              disabled={busy || index === 0}
              onClick={() => move(child, "up")}
              className={smallButton}
              aria-label={`Move ${child.personName} up`}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={busy || index === family.children.length - 1}
              onClick={() => move(child, "down")}
              className={smallButton}
              aria-label={`Move ${child.personName} down`}
            >
              ↓
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  removeFamilyChildAction({
                    personId,
                    familyChildId: child.id,
                    expectedUpdatedAt: child.updatedAt,
                  }),
                )
              }
              className={removeButton}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <ActionError message={error} />
    </div>
  );
}

function isUnionType(value: string): value is UnionType {
  return (Constants.public.Enums.union_type as readonly string[]).includes(
    value,
  );
}
