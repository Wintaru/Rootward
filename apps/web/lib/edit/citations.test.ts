import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type {
  CitationEditRow,
  CitationEventOption,
  CitationFactOption,
} from "@/lib/db/source-edit";

import {
  citationsFromLoaded,
  citationsReducer,
  dateColumnsFromRaw,
  describeCitationConflicts,
  diffCitations,
  isCitationsDiffEmpty,
  reconcileCitationsAfterSave,
} from "./citations";

const PERSON_ID = "person-1";
const EVENT_ID = "event-1";
const FACT_ID = "fact-1";

const PERSON_CITATION: CitationEditRow = {
  id: "c1",
  updatedAt: "2026-01-01T00:00:00Z",
  sourceId: "s1",
  ownerType: "person",
  ownerId: PERSON_ID,
  page: "12",
  dataText: "Household record",
  quality: 2,
  dateRaw: "1850",
};

const EVENT_CITATION: CitationEditRow = {
  id: "c2",
  updatedAt: "2026-01-01T00:00:00Z",
  sourceId: "s2",
  ownerType: "event",
  ownerId: EVENT_ID,
  page: null,
  dataText: null,
  quality: null,
  dateRaw: "",
};

const FACT_CITATION: CitationEditRow = {
  id: "c3",
  updatedAt: "2026-01-01T00:00:00Z",
  sourceId: "s1",
  ownerType: "fact",
  ownerId: FACT_ID,
  page: null,
  dataText: null,
  quality: null,
  dateRaw: "",
};

const BIRTH_EVENT: CitationEventOption = {
  id: EVENT_ID,
  type: "birth",
  typeOther: null,
};

const OCCUPATION_FACT: CitationFactOption = {
  id: FACT_ID,
  type: "occupation",
  typeOther: null,
};

const SOURCE_TITLES = new Map([["s1", "1900 Census"]]);

describe("citationsFromLoaded", () => {
  it("maps null text columns to empty strings and carries quality through", () => {
    const [draft] = citationsFromLoaded([EVENT_CITATION]);
    expect(draft!.page).toBe("");
    expect(draft!.dataText).toBe("");
    expect(draft!.quality).toBeNull();
    expect(draft!.sourceId).toBe("s2");
  });
});

describe("citationsReducer", () => {
  it("adds a blank row with no source chosen under the given owner", () => {
    const next = citationsReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "fact",
      ownerId: FACT_ID,
    });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        ownerType: "fact",
        ownerId: FACT_ID,
        sourceId: null,
        page: "",
        dataText: "",
        quality: null,
        dateRaw: "",
      },
    ]);
  });

  it("updates a single field, including quality and sourceId", () => {
    const state = citationsFromLoaded([PERSON_CITATION]);
    const withQuality = citationsReducer(state, {
      type: "field_changed",
      id: "c1",
      field: "quality",
      value: 3,
    });
    expect(withQuality[0]!.quality).toBe(3);

    const withSource = citationsReducer(withQuality, {
      type: "field_changed",
      id: "c1",
      field: "sourceId",
      value: "s2",
    });
    expect(withSource[0]!.sourceId).toBe("s2");
  });

  it("removes a row", () => {
    const state = citationsFromLoaded([PERSON_CITATION, EVENT_CITATION]);
    const next = citationsReducer(state, { type: "removed", id: "c1" });
    expect(next.map((row) => row.id)).toEqual(["c2"]);
  });

  it("row_reset restores a row this list had already deleted locally", () => {
    const state = citationsReducer(citationsFromLoaded([PERSON_CITATION]), {
      type: "removed",
      id: "c1",
    });
    const theirs: CitationEditRow = { ...PERSON_CITATION, page: "99" };
    const next = citationsReducer(state, {
      type: "row_reset",
      id: "c1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["c1"]);
    expect(next[0]!.page).toBe("99");
  });

  it("row_reset removes the row when it was deleted elsewhere", () => {
    const state = citationsFromLoaded([PERSON_CITATION]);
    const next = citationsReducer(state, {
      type: "row_reset",
      id: "c1",
      row: null,
    });
    expect(next).toEqual([]);
  });
});

describe("dateColumnsFromRaw", () => {
  it("clears every column but the not-null default calendar for blank input", () => {
    expect(dateColumnsFromRaw("  ")).toEqual({
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

describe("diffCitations", () => {
  it("is empty when nothing changed", () => {
    const loaded = [PERSON_CITATION, EVENT_CITATION];
    const current = citationsFromLoaded(loaded);
    expect(isCitationsDiffEmpty(diffCitations(loaded, current))).toBe(true);
  });

  it("skips an added row with no source chosen, even with other fields filled in", () => {
    // `citation.source_id` is the one not-null column, so it alone decides
    // whether a new row is insertable — same rule as `facts.ts`'s `type`.
    const added = citationsReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "person",
      ownerId: PERSON_ID,
    });
    const withPage = citationsReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "page",
      value: "5",
    });
    expect(isCitationsDiffEmpty(diffCitations([], withPage))).toBe(true);
  });

  it("diffs a filled-in added row as an insert scoped to its own owner", () => {
    const added = citationsReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "fact",
      ownerId: FACT_ID,
    });
    const withSource = citationsReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "sourceId",
      value: "s1",
    });
    const diff = diffCitations([], withSource);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        ownerType: "fact",
        ownerId: FACT_ID,
        sourceId: "s1",
        page: null,
        dataText: null,
        quality: null,
        date: dateColumnsFromRaw(""),
      },
    ]);
  });

  it("diffs a changed quality as an update", () => {
    const current = citationsReducer(citationsFromLoaded([PERSON_CITATION]), {
      type: "field_changed",
      id: "c1",
      field: "quality",
      value: 0,
    });
    const diff = diffCitations([PERSON_CITATION], current);
    expect(diff.updates).toEqual([
      {
        id: "c1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { quality: 0 },
      },
    ]);
  });

  it("diffs a changed date as an update carrying the full parsed column set", () => {
    const current = citationsReducer(citationsFromLoaded([PERSON_CITATION]), {
      type: "field_changed",
      id: "c1",
      field: "dateRaw",
      value: "ABT 1851",
    });
    const diff = diffCitations([PERSON_CITATION], current);
    expect(diff.updates).toEqual([
      {
        id: "c1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { date: dateColumnsFromRaw("ABT 1851") },
      },
    ]);
  });

  it("diffs a removed row as a delete", () => {
    const current = citationsReducer(citationsFromLoaded([PERSON_CITATION]), {
      type: "removed",
      id: "c1",
    });
    const diff = diffCitations([PERSON_CITATION], current);
    expect(diff.deletes).toEqual([
      { id: "c1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileCitationsAfterSave", () => {
  it("adopts the server row for a successful insert", () => {
    const saved: CitationEditRow = {
      ...PERSON_CITATION,
      id: "temp-1",
      updatedAt: "2026-02-01T00:00:00Z",
    };
    const current = citationsReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "person",
      ownerId: PERSON_ID,
    });

    const reconciled = reconcileCitationsAfterSave([], current, {
      inserted: [saved],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([saved]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = citationsReducer(citationsFromLoaded([PERSON_CITATION]), {
      type: "field_changed",
      id: "c1",
      field: "page",
      value: "Edited locally",
    });

    const reconciled = reconcileCitationsAfterSave([PERSON_CITATION], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([PERSON_CITATION]);
    expect(reconciled.current[0]!.page).toBe("Edited locally");
  });
});

describe("describeCitationConflicts", () => {
  it("titles a person-owned conflict and resolves source titles via the lookup", () => {
    const current = citationsFromLoaded([PERSON_CITATION]);
    const conflict: RowConflict<CitationEditRow> = {
      id: "c1",
      theirs: { ...PERSON_CITATION, page: "99" },
      changedBy: "Ada",
    };

    const [item] = describeCitationConflicts(
      [conflict],
      current,
      [],
      [],
      SOURCE_TITLES,
    );
    expect(item!.title).toBe("Citation on this person");
    expect(item!.changedBy).toBe("Ada");
    expect(item!.fields).toEqual([
      { label: "Page", yours: "12", theirs: "99" },
    ]);
  });

  it("titles an event-owned conflict using the event's label", () => {
    const current = citationsFromLoaded([EVENT_CITATION]);
    const conflict: RowConflict<CitationEditRow> = {
      id: "c2",
      theirs: { ...EVENT_CITATION, page: "1" },
      changedBy: null,
    };

    const [item] = describeCitationConflicts(
      [conflict],
      current,
      [BIRTH_EVENT],
      [],
      SOURCE_TITLES,
    );
    expect(item!.title).toBe("Citation on their Birth");
  });

  it("titles a fact-owned conflict using the fact's label", () => {
    const current = citationsFromLoaded([FACT_CITATION]);
    const conflict: RowConflict<CitationEditRow> = {
      id: "c3",
      theirs: { ...FACT_CITATION, page: "1" },
      changedBy: null,
    };

    const [item] = describeCitationConflicts(
      [conflict],
      current,
      [],
      [OCCUPATION_FACT],
      SOURCE_TITLES,
    );
    expect(item!.title).toBe("Citation on their Occupation");
  });

  it("marks a citation deleted elsewhere with no fields", () => {
    const current = citationsFromLoaded([PERSON_CITATION]);
    const conflict: RowConflict<CitationEditRow> = {
      id: "c1",
      theirs: null,
      changedBy: null,
    };

    const [item] = describeCitationConflicts(
      [conflict],
      current,
      [],
      [],
      SOURCE_TITLES,
    );
    expect(item!.deleted).toBe(true);
    expect(item!.fields).toEqual([]);
  });
});
