import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { FactEditRow } from "@/lib/db/fact-edit";

import {
  dateColumnsFromRaw,
  describeFactConflicts,
  diffFacts,
  factIsSensitive,
  factsFromLoaded,
  factsReducer,
  isFactsDiffEmpty,
  reconcileFactsAfterSave,
} from "./facts";

const ROW_A: FactEditRow = {
  id: "f1",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "occupation",
  typeOther: null,
  value: "Carpenter",
  visibility: "everyone_approved",
  isSensitive: false,
  placeName: "Boston",
  dateRaw: "1850",
};

const ROW_B: FactEditRow = {
  id: "f2",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "ssn",
  typeOther: null,
  value: null,
  visibility: "hidden",
  isSensitive: true,
  placeName: null,
  dateRaw: "",
};

describe("factsFromLoaded", () => {
  it("maps null text columns to empty strings for the draft", () => {
    const [draft] = factsFromLoaded([ROW_A]);
    expect(draft!.typeOther).toBe("");
    expect(draft!.dateRaw).toBe("1850");
    expect(draft!.placeName).toBe("Boston");
    expect(draft!.value).toBe("Carpenter");
    expect(draft!.visibility).toBe("everyone_approved");
  });
});

describe("factIsSensitive", () => {
  it("is true for ssn, national_id, and medical", () => {
    expect(factIsSensitive("ssn")).toBe(true);
    expect(factIsSensitive("national_id")).toBe(true);
    expect(factIsSensitive("medical")).toBe(true);
  });

  it("is false for other types and for no type chosen yet", () => {
    expect(factIsSensitive("occupation")).toBe(false);
    expect(factIsSensitive("other")).toBe(false);
    expect(factIsSensitive(null)).toBe(false);
  });
});

describe("factsReducer", () => {
  it("adds a blank row with no type chosen and default visibility", () => {
    const next = factsReducer([], { type: "added", id: "temp-1" });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        type: null,
        typeOther: "",
        dateRaw: "",
        placeName: "",
        value: "",
        visibility: "everyone_approved",
      },
    ]);
  });

  it("updates a single field on the matching row", () => {
    const state = factsFromLoaded([ROW_A, ROW_B]);
    const next = factsReducer(state, {
      type: "field_changed",
      id: "f1",
      field: "placeName",
      value: "New York",
    });
    expect(next[0]!.placeName).toBe("New York");
    expect(next[1]!.placeName).toBe("");
  });

  it("updates visibility on the matching row", () => {
    const state = factsFromLoaded([ROW_A]);
    const next = factsReducer(state, {
      type: "field_changed",
      id: "f1",
      field: "visibility",
      value: "hidden",
    });
    expect(next[0]!.visibility).toBe("hidden");
  });

  it("clears typeOther when type changes away from other", () => {
    const withOther = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "type",
      value: "other",
    });
    const withCustomLabel = factsReducer(withOther, {
      type: "field_changed",
      id: "f1",
      field: "typeOther",
      value: "Custom fact",
    });
    const switchedAway = factsReducer(withCustomLabel, {
      type: "field_changed",
      id: "f1",
      field: "type",
      value: "occupation",
    });
    expect(switchedAway[0]!.type).toBe("occupation");
    expect(switchedAway[0]!.typeOther).toBe("");
  });

  it("keeps typeOther when type is re-set to other", () => {
    const state = factsFromLoaded([ROW_A]);
    const next = factsReducer(state, {
      type: "field_changed",
      id: "f1",
      field: "type",
      value: "other",
    });
    expect(next[0]!.type).toBe("other");
    expect(next[0]!.typeOther).toBe("");
  });

  it("removes a row", () => {
    const state = factsFromLoaded([ROW_A, ROW_B]);
    const next = factsReducer(state, { type: "removed", id: "f1" });
    expect(next.map((row) => row.id)).toEqual(["f2"]);
  });

  it("replaces the whole list on reconciled", () => {
    const state = factsFromLoaded([ROW_A]);
    const replacement = factsFromLoaded([ROW_B]);
    const next = factsReducer(state, {
      type: "reconciled",
      rows: replacement,
    });
    expect(next).toBe(replacement);
  });

  it("row_reset replaces a row's fields with the server's current row", () => {
    const state = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "value",
      value: "Edited locally",
    });
    const theirs: FactEditRow = { ...ROW_A, value: "Their edit" };
    const next = factsReducer(state, {
      type: "row_reset",
      id: "f1",
      row: theirs,
    });
    expect(next[0]!.value).toBe("Their edit");
  });

  it("row_reset restores a row this section had already deleted locally", () => {
    // "Take theirs" on a delete-vs-edit conflict: the row is gone from
    // `state` (the local "Remove" already ran) but still exists server-side.
    const state = factsReducer(factsFromLoaded([ROW_A, ROW_B]), {
      type: "removed",
      id: "f1",
    });
    const theirs: FactEditRow = { ...ROW_A, value: "Their edit" };
    const next = factsReducer(state, {
      type: "row_reset",
      id: "f1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["f2", "f1"]);
    expect(next.find((row) => row.id === "f1")!.value).toBe("Their edit");
  });

  it("row_reset removes the row when it was deleted elsewhere", () => {
    const state = factsFromLoaded([ROW_A, ROW_B]);
    const next = factsReducer(state, {
      type: "row_reset",
      id: "f1",
      row: null,
    });
    expect(next.map((row) => row.id)).toEqual(["f2"]);
  });
});

describe("dateColumnsFromRaw", () => {
  it("clears every column but the not-null default calendar for blank input", () => {
    expect(dateColumnsFromRaw("   ")).toEqual({
      date_value_raw: null,
      date_kind: null,
      date_year1: null,
      date_month1: null,
      date_day1: null,
      date_year2: null,
      date_month2: null,
      date_day2: null,
      date_calendar: "gregorian",
      date_dual_year: null,
      date_phrase: null,
    });
  });

  it("parses non-blank input via parseGenealogyDate", () => {
    const fields = dateColumnsFromRaw("ABT 1850");
    expect(fields.date_kind).toBe("about");
    expect(fields.date_year1).toBe(1850);
  });
});

describe("diffFacts", () => {
  it("is empty when nothing changed", () => {
    const loaded = [ROW_A, ROW_B];
    const current = factsFromLoaded(loaded);
    expect(isFactsDiffEmpty(diffFacts(loaded, current))).toBe(true);
  });

  it("diffs a new row with a type chosen as an insert", () => {
    const added = factsReducer([], { type: "added", id: "temp-1" });
    const withType = factsReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "type",
      value: "eye_color",
    });
    const diff = diffFacts([], withType);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        type: "eye_color",
        typeOther: null,
        value: null,
        visibility: "everyone_approved",
        date: dateColumnsFromRaw(""),
        placeName: null,
      },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("skips an added row with no type chosen, even with other fields filled in", () => {
    // Deliberately different from `diffAdditionalNames`' "every field blank"
    // rule — `fact.type` is the one column the database requires, so it is
    // the only thing that decides whether a new row is insertable.
    const added = factsReducer([], { type: "added", id: "temp-1" });
    const withPlace = factsReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "placeName",
      value: "Chicago",
    });
    const diff = diffFacts([], withPlace);
    expect(isFactsDiffEmpty(diff)).toBe(true);
  });

  it("diffs a changed value field on an existing row as an update", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "value",
      value: "Cabinet maker",
    });
    const diff = diffFacts([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "f1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { value: "Cabinet maker" },
      },
    ]);
  });

  it("diffs a changed visibility as an update", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "visibility",
      value: "hidden",
    });
    const diff = diffFacts([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "f1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { visibility: "hidden" },
      },
    ]);
  });

  it("diffs a changed date as an update carrying the full parsed column set", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "dateRaw",
      value: "ABT 1851",
    });
    const diff = diffFacts([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "f1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { date: dateColumnsFromRaw("ABT 1851") },
      },
    ]);
  });

  it("diffs a changed place as an update", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "placeName",
      value: "New York",
    });
    const diff = diffFacts([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "f1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { placeName: "New York" },
      },
    ]);
  });

  it("diffs a removed row as a delete", () => {
    const current = factsReducer(factsFromLoaded([ROW_A, ROW_B]), {
      type: "removed",
      id: "f1",
    });
    const diff = diffFacts([ROW_A, ROW_B], current);
    expect(diff.deletes).toEqual([
      { id: "f1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileFactsAfterSave", () => {
  it("adopts the server row without reordering the list", () => {
    const savedA: FactEditRow = { ...ROW_A, value: "Updated" };
    const current = factsFromLoaded([ROW_A, ROW_B]);

    const reconciled = reconcileFactsAfterSave([ROW_A, ROW_B], current, {
      inserted: [],
      updated: [savedA],
    });

    expect(reconciled.current.map((row) => row.id)).toEqual(["f1", "f2"]);
    expect(reconciled.baseline).toEqual([savedA, ROW_B]);
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "value",
      value: "Edited locally",
    });

    const reconciled = reconcileFactsAfterSave([ROW_A], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([ROW_A]);
    expect(reconciled.current[0]!.value).toBe("Edited locally");
  });
});

describe("describeFactConflicts", () => {
  it("shows only the fields that differ between yours and theirs", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "value",
      value: "Mine",
    });
    const conflict: RowConflict<FactEditRow> = {
      id: "f1",
      theirs: { ...ROW_A, value: "Theirs" },
      changedBy: "Alex",
    };

    const [item] = describeFactConflicts([conflict], current);
    expect(item!.title).toBe("Fact: Occupation");
    expect(item!.changedBy).toBe("Alex");
    expect(item!.deleted).toBe(false);
    expect(item!.fields).toEqual([
      { label: "Value", yours: "Mine", theirs: "Theirs" },
    ]);
  });

  it("shows a visibility change with its display label", () => {
    const current = factsReducer(factsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "f1",
      field: "visibility",
      value: "hidden",
    });
    const conflict: RowConflict<FactEditRow> = {
      id: "f1",
      theirs: ROW_A,
      changedBy: "Alex",
    };

    const [item] = describeFactConflicts([conflict], current);
    expect(item!.fields).toEqual([
      {
        label: "Visibility",
        yours: "Hidden (moderators only)",
        theirs: "Everyone (approved members)",
      },
    ]);
  });

  it("marks a row deleted elsewhere with no fields", () => {
    const current = factsFromLoaded([ROW_A]);
    const conflict: RowConflict<FactEditRow> = {
      id: "f1",
      theirs: null,
      changedBy: null,
    };

    const [item] = describeFactConflicts([conflict], current);
    expect(item!.title).toBe("Fact: Occupation");
    expect(item!.deleted).toBe(true);
    expect(item!.fields).toEqual([]);
  });
});
