import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { PersonEditFields } from "@/lib/db/person-edit";

import {
  describePersonFieldsConflict,
  isEditablePersonVisibility,
  isSex,
  nameGenderDraft,
  nameGenderPatch,
  referenceNumbersDraft,
  referenceNumbersPatch,
} from "./person-fields";

const LOADED: PersonEditFields = {
  id: "p1",
  updatedAt: "2026-01-01T00:00:00Z",
  givenName: "Ada",
  surname: "Lovelace",
  namePrefix: null,
  nameSuffix: null,
  nickname: null,
  sex: "female",
  visibility: "everyone_approved",
  isLiving: null,
  familysearchId: "FS-1",
  ancestralFileNumber: null,
  userReferenceNumber: null,
};

describe("nameGenderDraft / nameGenderPatch", () => {
  it("round-trips an unmodified draft to no patch", () => {
    const draft = nameGenderDraft(LOADED);
    expect(nameGenderPatch(LOADED, draft)).toBeNull();
  });

  it("maps null text fields to empty strings for the draft", () => {
    const draft = nameGenderDraft(LOADED);
    expect(draft.namePrefix).toBe("");
    expect(draft.nickname).toBe("");
  });

  it("carries the enum field through unchanged", () => {
    const draft = nameGenderDraft(LOADED);
    expect(draft.sex).toBe("female");
  });

  it("diffs a changed text field, normalising blank to null", () => {
    const draft = nameGenderDraft(LOADED);
    const patch = nameGenderPatch(LOADED, { ...draft, nickname: "Countess" });
    expect(patch).toEqual({ nickname: "Countess" });
  });

  it("diffs a cleared text field to null, not empty string", () => {
    const draft = nameGenderDraft({ ...LOADED, nickname: "Countess" });
    const patch = nameGenderPatch(
      { ...LOADED, nickname: "Countess" },
      { ...draft, nickname: "   " },
    );
    expect(patch).toEqual({ nickname: null });
  });

  it("diffs a changed sex value", () => {
    const draft = nameGenderDraft(LOADED);
    const patch = nameGenderPatch(LOADED, { ...draft, sex: "other" });
    expect(patch).toEqual({ sex: "other" });
  });

  it("never includes a reference-numbers field", () => {
    const draft = nameGenderDraft(LOADED);
    const patch = nameGenderPatch(LOADED, { ...draft, givenName: "Augusta" });
    expect(patch).not.toHaveProperty("familysearchId");
  });

  it("diffs a changed visibility value", () => {
    const draft = nameGenderDraft(LOADED);
    const patch = nameGenderPatch(LOADED, {
      ...draft,
      visibility: "hidden",
    });
    expect(patch).toEqual({ visibility: "hidden" });
  });

  it("diffs the living override from computed to an explicit value", () => {
    const draft = nameGenderDraft(LOADED);
    const patch = nameGenderPatch(LOADED, { ...draft, isLiving: false });
    expect(patch).toEqual({ isLiving: false });
  });

  it("diffs the living override back to computed", () => {
    const loaded: PersonEditFields = { ...LOADED, isLiving: true };
    const draft = nameGenderDraft(loaded);
    const patch = nameGenderPatch(loaded, { ...draft, isLiving: null });
    expect(patch).toEqual({ isLiving: null });
  });
});

describe("referenceNumbersDraft / referenceNumbersPatch", () => {
  it("round-trips an unmodified draft to no patch", () => {
    const draft = referenceNumbersDraft(LOADED);
    expect(referenceNumbersPatch(LOADED, draft)).toBeNull();
  });

  it("diffs a changed reference number", () => {
    const draft = referenceNumbersDraft(LOADED);
    const patch = referenceNumbersPatch(LOADED, {
      ...draft,
      ancestralFileNumber: "AF-9",
    });
    expect(patch).toEqual({ ancestralFileNumber: "AF-9" });
  });

  it("never includes a name-gender field", () => {
    const draft = referenceNumbersDraft(LOADED);
    const patch = referenceNumbersPatch(LOADED, {
      ...draft,
      familysearchId: "FS-2",
    });
    expect(patch).not.toHaveProperty("givenName");
  });
});

describe("isSex", () => {
  it("accepts every value of the sex enum", () => {
    expect(isSex("male")).toBe(true);
    expect(isSex("female")).toBe(true);
    expect(isSex("unknown")).toBe(true);
    expect(isSex("other")).toBe(true);
  });

  it("rejects an unrecognised value", () => {
    expect(isSex("nonbinary")).toBe(false);
    expect(isSex("")).toBe(false);
  });
});

describe("isEditablePersonVisibility", () => {
  it("accepts the MVP's offered values", () => {
    expect(isEditablePersonVisibility("everyone_approved")).toBe(true);
    expect(isEditablePersonVisibility("moderators_only")).toBe(true);
    expect(isEditablePersonVisibility("hidden")).toBe(true);
  });

  it("rejects the post-MVP close_family value", () => {
    expect(isEditablePersonVisibility("close_family")).toBe(false);
  });

  it("rejects an unrecognised value", () => {
    expect(isEditablePersonVisibility("")).toBe(false);
  });
});

describe("describePersonFieldsConflict", () => {
  it("shows every patched field against the row's current value", () => {
    const conflict: RowConflict<PersonEditFields> = {
      id: "p1",
      theirs: { ...LOADED, nickname: "Theirs" },
      changedBy: "Alex",
    };
    const item = describePersonFieldsConflict(
      "p1",
      { nickname: "Mine" },
      conflict,
    );
    expect(item.changedBy).toBe("Alex");
    expect(item.deleted).toBe(false);
    expect(item.fields).toEqual([
      { label: "Nickname", yours: "Mine", theirs: "Theirs" },
    ]);
  });

  it("marks a row deleted elsewhere with no fields", () => {
    const conflict: RowConflict<PersonEditFields> = {
      id: "p1",
      theirs: null,
      changedBy: null,
    };
    const item = describePersonFieldsConflict(
      "p1",
      { nickname: "Mine" },
      conflict,
    );
    expect(item.deleted).toBe(true);
    expect(item.fields).toEqual([]);
  });

  it("shows a boolean living override as Living / Deceased, not true/false", () => {
    const conflict: RowConflict<PersonEditFields> = {
      id: "p1",
      theirs: { ...LOADED, isLiving: true },
      changedBy: "Alex",
    };
    const item = describePersonFieldsConflict(
      "p1",
      { isLiving: false },
      conflict,
    );
    expect(item.fields).toEqual([
      { label: "Living", yours: "Deceased", theirs: "Living" },
    ]);
  });

  it("shows a null living override as Computed, not blank", () => {
    const conflict: RowConflict<PersonEditFields> = {
      id: "p1",
      theirs: { ...LOADED, isLiving: true },
      changedBy: "Alex",
    };
    const item = describePersonFieldsConflict(
      "p1",
      { isLiving: null },
      conflict,
    );
    expect(item.fields).toEqual([
      { label: "Living", yours: "Computed", theirs: "Living" },
    ]);
  });
});
