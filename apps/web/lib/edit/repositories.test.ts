import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { RepositoryEditRow } from "@/lib/db/source-edit";

import {
  describeRepositoryConflicts,
  diffRepositories,
  isRepositoriesDiffEmpty,
  reconcileRepositoriesAfterSave,
  repositoriesFromLoaded,
  repositoriesReducer,
} from "./repositories";

const REPO_A: RepositoryEditRow = {
  id: "r1",
  updatedAt: "2026-01-01T00:00:00Z",
  name: "Boston Archive",
  address: "1 Main St",
  phone: "555-0100",
  email: "info@example.org",
  website: "https://example.org",
};

describe("repositoriesFromLoaded", () => {
  it("maps null text columns to empty strings for the draft", () => {
    const [draft] = repositoriesFromLoaded([
      { ...REPO_A, address: null, phone: null, email: null, website: null },
    ]);
    expect(draft!.address).toBe("");
    expect(draft!.phone).toBe("");
    expect(draft!.email).toBe("");
    expect(draft!.website).toBe("");
    expect(draft!.name).toBe("Boston Archive");
  });
});

describe("repositoriesReducer", () => {
  it("adds a blank row", () => {
    const next = repositoriesReducer([], { type: "added", id: "temp-1" });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        name: "",
        address: "",
        phone: "",
        email: "",
        website: "",
      },
    ]);
  });

  it("updates a single field on the matching row", () => {
    const state = repositoriesFromLoaded([REPO_A]);
    const next = repositoriesReducer(state, {
      type: "field_changed",
      id: "r1",
      field: "name",
      value: "New York Archive",
    });
    expect(next[0]!.name).toBe("New York Archive");
  });

  it("removes a row", () => {
    const state = repositoriesFromLoaded([REPO_A]);
    const next = repositoriesReducer(state, { type: "removed", id: "r1" });
    expect(next).toEqual([]);
  });

  it("row_reset restores a row this list had already deleted locally", () => {
    const state = repositoriesReducer(repositoriesFromLoaded([REPO_A]), {
      type: "removed",
      id: "r1",
    });
    const theirs: RepositoryEditRow = { ...REPO_A, name: "Their edit" };
    const next = repositoriesReducer(state, {
      type: "row_reset",
      id: "r1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["r1"]);
    expect(next[0]!.name).toBe("Their edit");
  });

  it("row_reset removes the row when it was deleted elsewhere", () => {
    const state = repositoriesFromLoaded([REPO_A]);
    const next = repositoriesReducer(state, {
      type: "row_reset",
      id: "r1",
      row: null,
    });
    expect(next).toEqual([]);
  });
});

describe("diffRepositories", () => {
  it("is empty when nothing changed", () => {
    const current = repositoriesFromLoaded([REPO_A]);
    expect(isRepositoriesDiffEmpty(diffRepositories([REPO_A], current))).toBe(
      true,
    );
  });

  it("skips an added row left entirely blank", () => {
    const current = repositoriesReducer([], { type: "added", id: "temp-1" });
    expect(isRepositoriesDiffEmpty(diffRepositories([], current))).toBe(true);
  });

  it("diffs a filled-in added row as an insert", () => {
    const added = repositoriesReducer([], { type: "added", id: "temp-1" });
    const withName = repositoriesReducer(added, {
      type: "field_changed",
      id: "temp-1",
      field: "name",
      value: "New Repository",
    });
    const diff = diffRepositories([], withName);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        name: "New Repository",
        address: null,
        phone: null,
        email: null,
        website: null,
      },
    ]);
  });

  it("diffs a changed field as an update", () => {
    const current = repositoriesReducer(repositoriesFromLoaded([REPO_A]), {
      type: "field_changed",
      id: "r1",
      field: "phone",
      value: "555-0199",
    });
    const diff = diffRepositories([REPO_A], current);
    expect(diff.updates).toEqual([
      {
        id: "r1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { phone: "555-0199" },
      },
    ]);
  });

  it("diffs a removed row as a delete", () => {
    const current = repositoriesReducer(repositoriesFromLoaded([REPO_A]), {
      type: "removed",
      id: "r1",
    });
    const diff = diffRepositories([REPO_A], current);
    expect(diff.deletes).toEqual([
      { id: "r1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileRepositoriesAfterSave", () => {
  it("adopts the server row for a successful insert", () => {
    const saved: RepositoryEditRow = {
      ...REPO_A,
      id: "temp-1",
      updatedAt: "2026-02-01T00:00:00Z",
    };
    const current = repositoriesReducer([], { type: "added", id: "temp-1" });

    const reconciled = reconcileRepositoriesAfterSave([], current, {
      inserted: [saved],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([saved]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = repositoriesReducer(repositoriesFromLoaded([REPO_A]), {
      type: "field_changed",
      id: "r1",
      field: "name",
      value: "Edited locally",
    });

    const reconciled = reconcileRepositoriesAfterSave([REPO_A], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([REPO_A]);
    expect(reconciled.current[0]!.name).toBe("Edited locally");
  });
});

describe("describeRepositoryConflicts", () => {
  it("titles a conflict by name and lists only differing fields", () => {
    const current = repositoriesFromLoaded([REPO_A]);
    const conflict: RowConflict<RepositoryEditRow> = {
      id: "r1",
      theirs: { ...REPO_A, phone: "555-9999" },
      changedBy: "Ada",
    };

    const [item] = describeRepositoryConflicts([conflict], current);
    expect(item!.title).toBe("Repository: Boston Archive");
    expect(item!.changedBy).toBe("Ada");
    expect(item!.fields).toEqual([
      { label: "Phone", yours: "555-0100", theirs: "555-9999" },
    ]);
  });

  it("marks a repository deleted elsewhere with no fields", () => {
    const current = repositoriesFromLoaded([REPO_A]);
    const conflict: RowConflict<RepositoryEditRow> = {
      id: "r1",
      theirs: null,
      changedBy: null,
    };

    const [item] = describeRepositoryConflicts([conflict], current);
    expect(item!.deleted).toBe(true);
    expect(item!.fields).toEqual([]);
  });
});
