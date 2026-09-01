import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { SourceEditRow } from "@/lib/db/source-edit";

import {
  describeSourceConflicts,
  diffSources,
  isSourcesDiffEmpty,
  reconcileSourcesAfterSave,
  sourcesFromLoaded,
  sourcesReducer,
} from "./sources";

const SOURCE_A: SourceEditRow = {
  id: "s1",
  updatedAt: "2026-01-01T00:00:00Z",
  title: "1900 Census",
  author: "US Census Bureau",
  publicationInfo: "Washington, DC",
  repositoryId: "r1",
  sourceText: "Household of Samuel Ashby.",
};

const REPO_NAMES = new Map([["r1", "National Archive"]]);

describe("sourcesFromLoaded", () => {
  it("maps null text columns to empty strings, keeps repositoryId as-is", () => {
    const [draft] = sourcesFromLoaded([
      { ...SOURCE_A, author: null, publicationInfo: null, sourceText: null },
    ]);
    expect(draft!.author).toBe("");
    expect(draft!.publicationInfo).toBe("");
    expect(draft!.sourceText).toBe("");
    expect(draft!.repositoryId).toBe("r1");
  });
});

describe("sourcesReducer", () => {
  it("adds a blank row with no repository chosen", () => {
    const next = sourcesReducer([], { type: "added", id: "temp-1" });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        title: "",
        author: "",
        publicationInfo: "",
        repositoryId: null,
        sourceText: "",
      },
    ]);
  });

  it("updates a single field, including clearing the repository", () => {
    const state = sourcesFromLoaded([SOURCE_A]);
    const next = sourcesReducer(state, {
      type: "field_changed",
      id: "s1",
      field: "repositoryId",
      value: null,
    });
    expect(next[0]!.repositoryId).toBeNull();
  });

  it("removes a row", () => {
    const state = sourcesFromLoaded([SOURCE_A]);
    const next = sourcesReducer(state, { type: "removed", id: "s1" });
    expect(next).toEqual([]);
  });

  it("row_reset restores a row this list had already deleted locally", () => {
    const state = sourcesReducer(sourcesFromLoaded([SOURCE_A]), {
      type: "removed",
      id: "s1",
    });
    const theirs: SourceEditRow = { ...SOURCE_A, title: "Their edit" };
    const next = sourcesReducer(state, {
      type: "row_reset",
      id: "s1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["s1"]);
    expect(next[0]!.title).toBe("Their edit");
  });
});

describe("diffSources", () => {
  it("is empty when nothing changed", () => {
    const current = sourcesFromLoaded([SOURCE_A]);
    expect(isSourcesDiffEmpty(diffSources([SOURCE_A], current))).toBe(true);
  });

  it("skips an added row left entirely blank", () => {
    const current = sourcesReducer([], { type: "added", id: "temp-1" });
    expect(isSourcesDiffEmpty(diffSources([], current))).toBe(true);
  });

  it("diffs a filled-in added row as an insert", () => {
    const added = sourcesReducer([], { type: "added", id: "temp-1" });
    const withTitle = sourcesReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "title",
      value: "New Source",
    });
    const diff = diffSources([], withTitle);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        title: "New Source",
        author: null,
        publicationInfo: null,
        repositoryId: null,
        sourceText: null,
      },
    ]);
  });

  it("diffs a changed repositoryId as an update", () => {
    const current = sourcesReducer(sourcesFromLoaded([SOURCE_A]), {
      type: "field_changed",
      id: "s1",
      field: "repositoryId",
      value: "r2",
    });
    const diff = diffSources([SOURCE_A], current);
    expect(diff.updates).toEqual([
      {
        id: "s1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { repositoryId: "r2" },
      },
    ]);
  });

  it("diffs a removed row as a delete", () => {
    const current = sourcesReducer(sourcesFromLoaded([SOURCE_A]), {
      type: "removed",
      id: "s1",
    });
    const diff = diffSources([SOURCE_A], current);
    expect(diff.deletes).toEqual([
      { id: "s1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileSourcesAfterSave", () => {
  it("adopts the server row for a successful insert", () => {
    const saved: SourceEditRow = {
      ...SOURCE_A,
      id: "temp-1",
      updatedAt: "2026-02-01T00:00:00Z",
    };
    const current = sourcesReducer([], { type: "added", id: "temp-1" });

    const reconciled = reconcileSourcesAfterSave([], current, {
      inserted: [saved],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([saved]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = sourcesReducer(sourcesFromLoaded([SOURCE_A]), {
      type: "field_changed",
      id: "s1",
      field: "title",
      value: "Edited locally",
    });

    const reconciled = reconcileSourcesAfterSave([SOURCE_A], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([SOURCE_A]);
    expect(reconciled.current[0]!.title).toBe("Edited locally");
  });
});

describe("describeSourceConflicts", () => {
  it("titles a conflict by title and resolves the repository name via the lookup", () => {
    const current = sourcesFromLoaded([SOURCE_A]);
    const conflict: RowConflict<SourceEditRow> = {
      id: "s1",
      theirs: { ...SOURCE_A, repositoryId: null },
      changedBy: null,
    };

    const [item] = describeSourceConflicts([conflict], current, REPO_NAMES);
    expect(item!.title).toBe("Source: 1900 Census");
    expect(item!.fields).toEqual([
      { label: "Repository", yours: "National Archive", theirs: "" },
    ]);
  });

  it("marks a source deleted elsewhere with no fields", () => {
    const current = sourcesFromLoaded([SOURCE_A]);
    const conflict: RowConflict<SourceEditRow> = {
      id: "s1",
      theirs: null,
      changedBy: null,
    };

    const [item] = describeSourceConflicts([conflict], current, REPO_NAMES);
    expect(item!.deleted).toBe(true);
    expect(item!.fields).toEqual([]);
  });
});
