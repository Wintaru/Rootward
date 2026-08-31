import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { NoteEditRow, NoteEventOption } from "@/lib/db/note-edit";

import {
  describeNoteConflicts,
  diffNotes,
  isNotesDiffEmpty,
  notesFromLoaded,
  notesReducer,
  reconcileNotesAfterSave,
} from "./notes";

const PERSON_ID = "person-1";
const EVENT_ID = "event-1";

const PERSON_NOTE: NoteEditRow = {
  id: "note-1",
  updatedAt: "2026-01-01T00:00:00Z",
  ownerType: "person",
  ownerId: PERSON_ID,
  text: "A note about the person.",
  sortOrder: 0,
};

const EVENT_NOTE: NoteEditRow = {
  id: "note-2",
  updatedAt: "2026-01-01T00:00:00Z",
  ownerType: "event",
  ownerId: EVENT_ID,
  text: "A note about the birth.",
  sortOrder: 0,
};

const BIRTH_EVENT: NoteEventOption = {
  id: EVENT_ID,
  type: "birth",
  typeOther: null,
};

describe("notesFromLoaded", () => {
  it("carries owner and text through unchanged", () => {
    const [draft] = notesFromLoaded([PERSON_NOTE]);
    expect(draft).toEqual({
      id: "note-1",
      updatedAt: "2026-01-01T00:00:00Z",
      ownerType: "person",
      ownerId: PERSON_ID,
      text: "A note about the person.",
    });
  });
});

describe("notesReducer", () => {
  it("adds a blank note under the given owner", () => {
    const next = notesReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "person",
      ownerId: PERSON_ID,
    });
    expect(next).toEqual([
      {
        id: "temp-1",
        updatedAt: null,
        ownerType: "person",
        ownerId: PERSON_ID,
        text: "",
      },
    ]);
  });

  it("updates a single note's text", () => {
    const state = notesFromLoaded([PERSON_NOTE, EVENT_NOTE]);
    const next = notesReducer(state, {
      type: "field_changed",
      id: "note-1",
      text: "Edited.",
    });
    expect(next[0]!.text).toBe("Edited.");
    expect(next[1]!.text).toBe(EVENT_NOTE.text);
  });

  it("moves within a group, skipping past rows from a different owner", () => {
    // Two person notes with one event note interleaved between them —
    // "move down" on the first person note must skip the event note and
    // swap with the second person note instead of the adjacent array slot.
    const secondPersonNote: NoteEditRow = {
      ...PERSON_NOTE,
      id: "note-3",
      sortOrder: 1,
    };
    const state = notesFromLoaded([PERSON_NOTE, EVENT_NOTE, secondPersonNote]);
    const next = notesReducer(state, {
      type: "moved",
      id: "note-1",
      direction: "down",
    });
    expect(next.map((row) => row.id)).toEqual(["note-3", "note-2", "note-1"]);
  });

  it("does nothing moving the only row in a group", () => {
    const state = notesFromLoaded([PERSON_NOTE, EVENT_NOTE]);
    const next = notesReducer(state, {
      type: "moved",
      id: "note-1",
      direction: "down",
    });
    expect(next.map((row) => row.id)).toEqual(["note-1", "note-2"]);
  });

  it("removes a note", () => {
    const state = notesFromLoaded([PERSON_NOTE, EVENT_NOTE]);
    const next = notesReducer(state, { type: "removed", id: "note-1" });
    expect(next.map((row) => row.id)).toEqual(["note-2"]);
  });

  it("replaces the whole list on reconciled", () => {
    const state = notesFromLoaded([PERSON_NOTE]);
    const replacement = notesFromLoaded([EVENT_NOTE]);
    const next = notesReducer(state, {
      type: "reconciled",
      rows: replacement,
    });
    expect(next).toBe(replacement);
  });

  it("row_reset replaces a note's fields with the server's current row", () => {
    const state = notesReducer(notesFromLoaded([PERSON_NOTE]), {
      type: "field_changed",
      id: "note-1",
      text: "Edited locally",
    });
    const theirs: NoteEditRow = { ...PERSON_NOTE, text: "Their edit" };
    const next = notesReducer(state, {
      type: "row_reset",
      id: "note-1",
      row: theirs,
    });
    expect(next[0]!.text).toBe("Their edit");
  });

  it("row_reset restores a note this section had already deleted locally", () => {
    // "Take theirs" on a delete-vs-edit conflict: the note is gone from
    // `state` (the local "Remove" already ran) but still exists server-side.
    const state = notesReducer(notesFromLoaded([PERSON_NOTE, EVENT_NOTE]), {
      type: "removed",
      id: "note-1",
    });
    const theirs: NoteEditRow = { ...PERSON_NOTE, text: "Their edit" };
    const next = notesReducer(state, {
      type: "row_reset",
      id: "note-1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["note-2", "note-1"]);
    expect(next.find((row) => row.id === "note-1")!.text).toBe("Their edit");
  });

  it("row_reset removes the note when it was deleted elsewhere", () => {
    const state = notesFromLoaded([PERSON_NOTE, EVENT_NOTE]);
    const next = notesReducer(state, {
      type: "row_reset",
      id: "note-1",
      row: null,
    });
    expect(next.map((row) => row.id)).toEqual(["note-2"]);
  });
});

describe("diffNotes", () => {
  it("is empty when nothing changed", () => {
    const loaded = [PERSON_NOTE, EVENT_NOTE];
    const current = notesFromLoaded(loaded);
    expect(isNotesDiffEmpty(diffNotes(loaded, current))).toBe(true);
  });

  it("skips an added note left blank", () => {
    const current = notesReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "person",
      ownerId: PERSON_ID,
    });
    const diff = diffNotes([], current);
    expect(isNotesDiffEmpty(diff)).toBe(true);
  });

  it("diffs a filled-in added note as an insert scoped to its own owner", () => {
    const added = notesReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "event",
      ownerId: EVENT_ID,
    });
    const withText = notesReducer(added, {
      type: "field_changed",
      id: "temp-1",
      text: "New note",
    });
    const diff = diffNotes([], withText);
    expect(diff.inserts).toEqual([
      {
        id: "temp-1",
        ownerType: "event",
        ownerId: EVENT_ID,
        text: "New note",
        sortOrder: 0,
      },
    ]);
  });

  it("diffs a changed text field as an update", () => {
    const current = notesReducer(notesFromLoaded([PERSON_NOTE]), {
      type: "field_changed",
      id: "note-1",
      text: "Changed",
    });
    const diff = diffNotes([PERSON_NOTE], current);
    expect(diff.updates).toEqual([
      {
        id: "note-1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { text: "Changed" },
      },
    ]);
  });

  it("scopes sortOrder to each owner's own group, not the flat array index", () => {
    // note-1 (person) sits before EVENT_NOTE in the array, but each is the
    // only row in its own owner group — neither's within-group index (0)
    // differs from its loaded sortOrder (0), so reordering the flat array
    // alone must not produce a spurious sortOrder update for either.
    const loaded = [PERSON_NOTE, EVENT_NOTE];
    const current = [...notesFromLoaded(loaded)].reverse();
    const diff = diffNotes(loaded, current);
    expect(isNotesDiffEmpty(diff)).toBe(true);
  });

  it("diffs a within-group reorder as sortOrder-only updates", () => {
    const secondPersonNote: NoteEditRow = {
      ...PERSON_NOTE,
      id: "note-3",
      sortOrder: 1,
    };
    const loaded = [PERSON_NOTE, secondPersonNote];
    const current = notesReducer(notesFromLoaded(loaded), {
      type: "moved",
      id: "note-3",
      direction: "up",
    });
    const diff = diffNotes(loaded, current);
    expect(diff.updates).toEqual([
      {
        id: "note-3",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { sortOrder: 0 },
      },
      {
        id: "note-1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { sortOrder: 1 },
      },
    ]);
  });

  it("diffs a removed note as a delete", () => {
    const loaded = [PERSON_NOTE, EVENT_NOTE];
    const current = notesReducer(notesFromLoaded(loaded), {
      type: "removed",
      id: "note-1",
    });
    const diff = diffNotes(loaded, current);
    expect(diff.deletes).toEqual([
      { id: "note-1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileNotesAfterSave", () => {
  it("adopts the server row for a successful insert", () => {
    const saved: NoteEditRow = {
      ...PERSON_NOTE,
      id: "temp-1",
      updatedAt: "2026-02-01T00:00:00Z",
    };
    const current = notesReducer([], {
      type: "added",
      id: "temp-1",
      ownerType: "person",
      ownerId: PERSON_ID,
    });

    const reconciled = reconcileNotesAfterSave([], current, {
      inserted: [saved],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([saved]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps the local edit and stale baseline for a note that conflicted", () => {
    const current = notesReducer(notesFromLoaded([PERSON_NOTE]), {
      type: "field_changed",
      id: "note-1",
      text: "Edited locally",
    });

    const reconciled = reconcileNotesAfterSave([PERSON_NOTE], current, {
      inserted: [],
      updated: [],
    });

    expect(reconciled.baseline).toEqual([PERSON_NOTE]);
    expect(reconciled.current[0]!.text).toBe("Edited locally");
  });
});

describe("describeNoteConflicts", () => {
  it("titles a person-owned conflict", () => {
    const current = notesFromLoaded([PERSON_NOTE]);
    const conflict: RowConflict<NoteEditRow> = {
      id: "note-1",
      theirs: { ...PERSON_NOTE, text: "Theirs" },
      changedBy: null,
    };

    const [item] = describeNoteConflicts([conflict], current, []);
    expect(item!.title).toBe("Note about this person");
    expect(item!.fields).toEqual([
      { label: "Text", yours: PERSON_NOTE.text, theirs: "Theirs" },
    ]);
  });

  it("titles an event-owned conflict using the event's label", () => {
    const current = notesFromLoaded([EVENT_NOTE]);
    const conflict: RowConflict<NoteEditRow> = {
      id: "note-2",
      theirs: { ...EVENT_NOTE, text: "Theirs" },
      changedBy: null,
    };

    const [item] = describeNoteConflicts([conflict], current, [BIRTH_EVENT]);
    expect(item!.title).toBe("Note about their Birth");
  });

  it("marks a note deleted elsewhere with no fields", () => {
    const current = notesFromLoaded([PERSON_NOTE]);
    const conflict: RowConflict<NoteEditRow> = {
      id: "note-1",
      theirs: null,
      changedBy: null,
    };

    const [item] = describeNoteConflicts([conflict], current, []);
    expect(item!.deleted).toBe(true);
    expect(item!.fields).toEqual([]);
  });
});
