import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { EventEditRow } from "@/lib/db/event-edit";

import {
  dateColumnsFromRaw,
  describeEventConflicts,
  diffEvents,
  eventsFromLoaded,
  eventsReducer,
  isEventsDiffEmpty,
  reconcileEventsAfterSave,
} from "./events";

const ROW_A: EventEditRow = {
  id: "e1",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "birth",
  typeOther: null,
  value: null,
  ageText: null,
  sortKey: "1850-06-01T00:00:00+00:00",
  placeName: "Boston",
  dateRaw: "1850",
};

const ROW_B: EventEditRow = {
  id: "e2",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "death",
  typeOther: null,
  value: null,
  ageText: null,
  sortKey: null,
  placeName: null,
  dateRaw: "",
};

describe("eventsFromLoaded", () => {
  it("maps null text columns to empty strings for the draft", () => {
    const [draft] = eventsFromLoaded([ROW_A]);
    expect(draft!.typeOther).toBe("");
    expect(draft!.value).toBe("");
    expect(draft!.ageText).toBe("");
    expect(draft!.dateRaw).toBe("1850");
    expect(draft!.placeName).toBe("Boston");
    expect(draft!.sortKey).toBe("1850-06-01T00:00:00+00:00");
  });
});

describe("eventsReducer", () => {
  it("adds a blank row with no type chosen", () => {
    const next = eventsReducer([], { type: "added", id: "temp-1" });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        type: null,
        typeOther: "",
        dateRaw: "",
        placeName: "",
        value: "",
        ageText: "",
        sortKey: null,
      },
    ]);
  });

  it("updates a single field on the matching row", () => {
    const state = eventsFromLoaded([ROW_A, ROW_B]);
    const next = eventsReducer(state, {
      type: "field_changed",
      id: "e1",
      field: "placeName",
      value: "New York",
    });
    expect(next[0]!.placeName).toBe("New York");
    expect(next[1]!.placeName).toBe("");
  });

  it("clears typeOther when type changes away from other", () => {
    const withOther = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "type",
      value: "other",
    });
    const withCustomLabel = eventsReducer(withOther, {
      type: "field_changed",
      id: "e1",
      field: "typeOther",
      value: "Family reunion",
    });
    const switchedAway = eventsReducer(withCustomLabel, {
      type: "field_changed",
      id: "e1",
      field: "type",
      value: "birth",
    });
    expect(switchedAway[0]!.type).toBe("birth");
    expect(switchedAway[0]!.typeOther).toBe("");
  });

  it("keeps typeOther when type is re-set to other", () => {
    const state = eventsFromLoaded([ROW_A]);
    const next = eventsReducer(state, {
      type: "field_changed",
      id: "e1",
      field: "type",
      value: "other",
    });
    expect(next[0]!.type).toBe("other");
    expect(next[0]!.typeOther).toBe("");
  });

  it("removes a row", () => {
    const state = eventsFromLoaded([ROW_A, ROW_B]);
    const next = eventsReducer(state, { type: "removed", id: "e1" });
    expect(next.map((row) => row.id)).toEqual(["e2"]);
  });

  it("replaces the whole list on reconciled", () => {
    const state = eventsFromLoaded([ROW_A]);
    const replacement = eventsFromLoaded([ROW_B]);
    const next = eventsReducer(state, {
      type: "reconciled",
      rows: replacement,
    });
    expect(next).toBe(replacement);
  });

  it("row_reset replaces a row's fields with the server's current row", () => {
    const state = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "value",
      value: "Edited locally",
    });
    const theirs: EventEditRow = { ...ROW_A, value: "Their edit" };
    const next = eventsReducer(state, {
      type: "row_reset",
      id: "e1",
      row: theirs,
    });
    expect(next[0]!.value).toBe("Their edit");
  });

  it("row_reset restores a row this section had already deleted locally", () => {
    // "Take theirs" on a delete-vs-edit conflict: the row is gone from
    // `state` (the local "Remove" already ran) but still exists server-side.
    const state = eventsReducer(eventsFromLoaded([ROW_A, ROW_B]), {
      type: "removed",
      id: "e1",
    });
    const theirs: EventEditRow = { ...ROW_A, value: "Their edit" };
    const next = eventsReducer(state, {
      type: "row_reset",
      id: "e1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["e2", "e1"]);
    expect(next.find((row) => row.id === "e1")!.value).toBe("Their edit");
  });

  it("row_reset removes the row when it was deleted elsewhere", () => {
    const state = eventsFromLoaded([ROW_A, ROW_B]);
    const next = eventsReducer(state, {
      type: "row_reset",
      id: "e1",
      row: null,
    });
    expect(next.map((row) => row.id)).toEqual(["e2"]);
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

describe("diffEvents", () => {
  it("is empty when nothing changed", () => {
    const loaded = [ROW_A, ROW_B];
    const current = eventsFromLoaded(loaded);
    expect(isEventsDiffEmpty(diffEvents(loaded, current))).toBe(true);
  });

  it("diffs a new row with a type chosen as an insert", () => {
    const added = eventsReducer([], { type: "added", id: "temp-1" });
    const withType = eventsReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "type",
      value: "residence",
    });
    const diff = diffEvents([], withType);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        type: "residence",
        typeOther: null,
        value: null,
        ageText: null,
        date: dateColumnsFromRaw(""),
        placeName: null,
      },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("skips an added row with no type chosen, even with other fields filled in", () => {
    // Deliberately different from `diffAdditionalNames`' "every field blank"
    // rule — `event.type` is the one column the database requires, so it is
    // the only thing that decides whether a new row is insertable.
    const added = eventsReducer([], { type: "added", id: "temp-1" });
    const withPlace = eventsReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "placeName",
      value: "Chicago",
    });
    const diff = diffEvents([], withPlace);
    expect(isEventsDiffEmpty(diff)).toBe(true);
  });

  it("diffs a changed value field on an existing row as an update", () => {
    const current = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "value",
      value: "Occupation: carpenter",
    });
    const diff = diffEvents([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "e1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { value: "Occupation: carpenter" },
      },
    ]);
  });

  it("diffs a changed date as an update carrying the full parsed column set", () => {
    const current = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "dateRaw",
      value: "ABT 1851",
    });
    const diff = diffEvents([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "e1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { date: dateColumnsFromRaw("ABT 1851") },
      },
    ]);
  });

  it("diffs a changed place as an update", () => {
    const current = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "placeName",
      value: "New York",
    });
    const diff = diffEvents([ROW_A], current);
    expect(diff.updates).toEqual([
      {
        id: "e1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { placeName: "New York" },
      },
    ]);
  });

  it("diffs a removed row as a delete", () => {
    const current = eventsReducer(eventsFromLoaded([ROW_A, ROW_B]), {
      type: "removed",
      id: "e1",
    });
    const diff = diffEvents([ROW_A, ROW_B], current);
    expect(diff.deletes).toEqual([
      { id: "e1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileEventsAfterSave", () => {
  it("adopts the server row and re-sorts by the new sortKey", () => {
    const savedA: EventEditRow = { ...ROW_A, sortKey: "1950-01-01T00:00:00Z" };
    const current = eventsFromLoaded([ROW_A, ROW_B]);

    const reconciled = reconcileEventsAfterSave([ROW_A, ROW_B], current, {
      inserted: [],
      updated: [savedA],
    });

    // ROW_B is undated (sortKey null, sorts last); savedA's new sortKey
    // (1950) still sorts before "undated", so order is unchanged here — the
    // reorder is exercised below with two dated rows that swap.
    expect(reconciled.current.map((row) => row.id)).toEqual(["e1", "e2"]);
    expect(reconciled.baseline).toEqual([savedA, ROW_B]);
  });

  it("reorders the display list when a saved row's sortKey moves it past another", () => {
    const early: EventEditRow = { ...ROW_B, sortKey: "1800-01-01T00:00:00Z" };
    const current = eventsFromLoaded([ROW_A, ROW_B]);

    const reconciled = reconcileEventsAfterSave([ROW_A, ROW_B], current, {
      inserted: [],
      updated: [early],
    });

    expect(reconciled.current.map((row) => row.id)).toEqual(["e2", "e1"]);
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "value",
      value: "Edited locally",
    });

    const reconciled = reconcileEventsAfterSave([ROW_A], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([ROW_A]);
    expect(reconciled.current[0]!.value).toBe("Edited locally");
  });
});

describe("describeEventConflicts", () => {
  it("shows only the fields that differ between yours and theirs", () => {
    const current = eventsReducer(eventsFromLoaded([ROW_A]), {
      type: "field_changed",
      id: "e1",
      field: "value",
      value: "Mine",
    });
    const conflict: RowConflict<EventEditRow> = {
      id: "e1",
      theirs: { ...ROW_A, value: "Theirs" },
      changedBy: "Alex",
    };

    const [item] = describeEventConflicts([conflict], current);
    expect(item!.title).toBe("Event: Birth");
    expect(item!.changedBy).toBe("Alex");
    expect(item!.deleted).toBe(false);
    expect(item!.fields).toEqual([
      { label: "Value", yours: "Mine", theirs: "Theirs" },
    ]);
  });

  it("marks a row deleted elsewhere with no fields", () => {
    const current = eventsFromLoaded([ROW_A]);
    const conflict: RowConflict<EventEditRow> = {
      id: "e1",
      theirs: null,
      changedBy: null,
    };

    const [item] = describeEventConflicts([conflict], current);
    expect(item!.title).toBe("Event: Birth");
    expect(item!.deleted).toBe(true);
    expect(item!.fields).toEqual([]);
  });
});
