import { describe, expect, it } from "vitest";

import type { EventEditRow } from "@/lib/db/event-edit";

import { unionStatusLine } from "./union-status";

function event(overrides: Partial<EventEditRow> & Pick<EventEditRow, "type">) {
  return {
    id: `e-${overrides.type}`,
    updatedAt: "2026-01-01T00:00:00Z",
    typeOther: null,
    value: null,
    ageText: null,
    sortKey: null,
    placeName: null,
    dateRaw: "",
    ...overrides,
  };
}

describe("unionStatusLine", () => {
  it("shows the union type with its marriage date and place", () => {
    expect(
      unionStatusLine({
        relationshipType: "married",
        endedBy: null,
        events: [
          event({
            type: "marriage",
            dateRaw: "12 Jun 1990",
            placeName: "Springfield",
          }),
        ],
      }),
    ).toEqual({ standing: "Married — 12 Jun 1990, Springfield", ended: null });
  });

  it("falls back to the bare type with no marriage event", () => {
    expect(
      unionStatusLine({
        relationshipType: "partnership",
        endedBy: null,
        events: [],
      }),
    ).toEqual({ standing: "Partnership", ended: null });
  });

  it("adds the ended segment from the ending event the server named", () => {
    expect(
      unionStatusLine({
        relationshipType: "married",
        endedBy: "divorce",
        events: [
          event({ type: "marriage", dateRaw: "1990" }),
          event({ type: "divorce", dateRaw: "abt 2003", placeName: "Reno" }),
        ],
      }),
    ).toEqual({
      standing: "Married — 1990",
      ended: "Divorced — abt 2003, Reno",
    });
  });

  it("labels the ended state even when its event carries no date", () => {
    expect(
      unionStatusLine({
        relationshipType: null,
        endedBy: "annulment",
        events: [event({ type: "annulment" })],
      }),
    ).toEqual({ standing: null, ended: "Annulled" });
  });
});
