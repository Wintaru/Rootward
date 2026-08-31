import { describe, expect, it } from "vitest";

import type { PersonNameEditRow } from "@/lib/db/person-edit";

import {
  additionalNamesReducer,
  diffAdditionalNames,
  isAdditionalNamesDiffEmpty,
  namesFromLoaded,
  reconcileAdditionalNamesAfterSave,
} from "./additional-names";

const ROW_A: PersonNameEditRow = {
  id: "n1",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "birth",
  givenName: "Ada",
  surname: "Byron",
  prefix: null,
  suffix: null,
  nickname: null,
  sortOrder: 0,
};

const ROW_B: PersonNameEditRow = {
  id: "n2",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "married",
  givenName: "Ada",
  surname: "Lovelace",
  prefix: null,
  suffix: null,
  nickname: null,
  sortOrder: 1,
};

describe("namesFromLoaded", () => {
  it("maps null text columns to empty strings for the draft", () => {
    const [draft] = namesFromLoaded([ROW_A]);
    expect(draft!.prefix).toBe("");
    expect(draft!.id).toBe("n1");
    expect(draft!.updatedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("additionalNamesReducer", () => {
  it("adds a blank row with the given id", () => {
    const next = additionalNamesReducer([], { type: "added", id: "temp-1" });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        type: null,
        givenName: "",
        surname: "",
        prefix: "",
        suffix: "",
        nickname: "",
      },
    ]);
  });

  it("updates a single field on the matching row", () => {
    const state = namesFromLoaded([ROW_A, ROW_B]);
    const next = additionalNamesReducer(state, {
      type: "field_changed",
      id: "n1",
      field: "givenName",
      value: "Augusta",
    });
    expect(next[0]!.givenName).toBe("Augusta");
    expect(next[1]!.givenName).toBe("Ada");
  });

  it("moves a row up", () => {
    const state = namesFromLoaded([ROW_A, ROW_B]);
    const next = additionalNamesReducer(state, {
      type: "moved",
      id: "n2",
      direction: "up",
    });
    expect(next.map((row) => row.id)).toEqual(["n2", "n1"]);
  });

  it("does nothing moving the first row up", () => {
    const state = namesFromLoaded([ROW_A, ROW_B]);
    const next = additionalNamesReducer(state, {
      type: "moved",
      id: "n1",
      direction: "up",
    });
    expect(next.map((row) => row.id)).toEqual(["n1", "n2"]);
  });

  it("does nothing moving the last row down", () => {
    const state = namesFromLoaded([ROW_A, ROW_B]);
    const next = additionalNamesReducer(state, {
      type: "moved",
      id: "n2",
      direction: "down",
    });
    expect(next.map((row) => row.id)).toEqual(["n1", "n2"]);
  });

  it("removes a row", () => {
    const state = namesFromLoaded([ROW_A, ROW_B]);
    const next = additionalNamesReducer(state, {
      type: "removed",
      id: "n1",
    });
    expect(next.map((row) => row.id)).toEqual(["n2"]);
  });

  it("replaces the whole list on reconciled", () => {
    const state = namesFromLoaded([ROW_A]);
    const replacement = namesFromLoaded([ROW_B]);
    const next = additionalNamesReducer(state, {
      type: "reconciled",
      rows: replacement,
    });
    expect(next).toBe(replacement);
  });
});

describe("diffAdditionalNames", () => {
  it("is empty when nothing changed", () => {
    const loaded = [ROW_A, ROW_B];
    const current = namesFromLoaded(loaded);
    const diff = diffAdditionalNames(loaded, current);
    expect(isAdditionalNamesDiffEmpty(diff)).toBe(true);
  });

  it("diffs a new row as an insert carrying its client-assigned id", () => {
    const loaded: PersonNameEditRow[] = [];
    const current = additionalNamesReducer([], {
      type: "added",
      id: "temp-1",
    });
    const withField = additionalNamesReducer(current, {
      type: "field_changed",
      id: "temp-1",
      field: "givenName",
      value: "Grace",
    });
    const diff = diffAdditionalNames(loaded, withField);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        type: null,
        givenName: "Grace",
        surname: null,
        prefix: null,
        suffix: null,
        nickname: null,
        sortOrder: 0,
      },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("skips an added row that was never filled in", () => {
    const current = additionalNamesReducer([], { type: "added", id: "temp-1" });
    const diff = diffAdditionalNames([], current);
    expect(isAdditionalNamesDiffEmpty(diff)).toBe(true);
  });

  it("still inserts an added row with only a type chosen", () => {
    const current = additionalNamesReducer([], { type: "added", id: "temp-1" });
    const withType = additionalNamesReducer(current, {
      type: "field_changed",
      id: "temp-1",
      field: "type",
      value: "nickname",
    });
    const diff = diffAdditionalNames([], withType);
    expect(diff.inserts).toHaveLength(1);
    expect(diff.inserts[0]!.type).toBe("nickname");
  });

  it("diffs a changed field on an existing row as an update", () => {
    const loaded = [ROW_A];
    const current = additionalNamesReducer(namesFromLoaded(loaded), {
      type: "field_changed",
      id: "n1",
      field: "surname",
      value: "Lovelace",
    });
    const diff = diffAdditionalNames(loaded, current);
    expect(diff.updates).toEqual([
      {
        id: "n1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { surname: "Lovelace" },
      },
    ]);
  });

  it("diffs a reorder alone as an update carrying only sortOrder", () => {
    const loaded = [ROW_A, ROW_B];
    const current = additionalNamesReducer(namesFromLoaded(loaded), {
      type: "moved",
      id: "n2",
      direction: "up",
    });
    const diff = diffAdditionalNames(loaded, current);
    expect(diff.updates).toEqual([
      {
        id: "n2",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { sortOrder: 0 },
      },
      {
        id: "n1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { sortOrder: 1 },
      },
    ]);
  });

  it("diffs a removed row as a delete", () => {
    const loaded = [ROW_A, ROW_B];
    const current = additionalNamesReducer(namesFromLoaded(loaded), {
      type: "removed",
      id: "n1",
    });
    const diff = diffAdditionalNames(loaded, current);
    expect(diff.deletes).toEqual([
      { id: "n1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("does not re-send an unchanged row's sortOrder as a delete or update", () => {
    const loaded = [ROW_A];
    const current = namesFromLoaded(loaded);
    const diff = diffAdditionalNames(loaded, current);
    expect(isAdditionalNamesDiffEmpty(diff)).toBe(true);
  });
});

describe("reconcileAdditionalNamesAfterSave", () => {
  it("adopts the server row for a successful insert", () => {
    const savedRow: PersonNameEditRow = {
      ...ROW_A,
      id: "temp-1",
      updatedAt: "2026-02-01T00:00:00Z",
    };
    const current = additionalNamesReducer([], { type: "added", id: "temp-1" });

    const reconciled = reconcileAdditionalNamesAfterSave([], current, {
      inserted: [savedRow],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([savedRow]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("adopts the server row for a successful update", () => {
    const savedRow: PersonNameEditRow = {
      ...ROW_A,
      updatedAt: "2026-02-01T00:00:00Z",
    };
    const current = namesFromLoaded([ROW_A]);

    const reconciled = reconcileAdditionalNamesAfterSave([ROW_A], current, {
      inserted: [],
      updated: [savedRow],
    });

    expect(reconciled.baseline).toEqual([savedRow]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = additionalNamesReducer(namesFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "n1",
      field: "surname",
      value: "Lovelace",
    });

    const reconciled = reconcileAdditionalNamesAfterSave([ROW_A], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([ROW_A]);
    expect(reconciled.current[0]!.surname).toBe("Lovelace");
  });
});
