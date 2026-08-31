import { describe, expect, it } from "vitest";

import { describeOtherEditors, presenceChannelName } from "./presence";

describe("presenceChannelName", () => {
  it("names the channel after the person", () => {
    expect(presenceChannelName("p1")).toBe("person:p1");
  });
});

describe("describeOtherEditors", () => {
  it("excludes the caller's own key", () => {
    const state = {
      self: [{ userId: "self", displayName: "Me", section: "events" }],
      other: [{ userId: "other", displayName: "Jane", section: "notes" }],
    };
    expect(describeOtherEditors(state, "self")).toEqual([
      { userId: "other", displayName: "Jane", section: "notes" },
    ]);
  });

  it("takes the latest entry for a key with more than one open connection", () => {
    const state = {
      other: [
        { userId: "other", displayName: "Jane", section: "events" },
        { userId: "other", displayName: "Jane", section: "notes" },
      ],
    };
    expect(describeOtherEditors(state, "self")).toEqual([
      { userId: "other", displayName: "Jane", section: "notes" },
    ]);
  });

  it("sorts by display name", () => {
    const state = {
      b: [{ userId: "b", displayName: "Bea", section: "events" }],
      a: [{ userId: "a", displayName: "Amir", section: "notes" }],
    };
    expect(
      describeOtherEditors(state, "self").map((e) => e.displayName),
    ).toEqual(["Amir", "Bea"]);
  });

  it("drops a key with an empty presence array", () => {
    expect(describeOtherEditors({ other: [] }, "self")).toEqual([]);
  });

  it("drops a malformed presence payload instead of throwing", () => {
    const state = {
      other: [{ userId: "other" }],
      another: [null],
      third: ["not an object"],
    };
    expect(describeOtherEditors(state, "self")).toEqual([]);
  });

  it("drops a payload whose section isn't a real edit section", () => {
    const state = {
      other: [
        { userId: "other", displayName: "Jane", section: "not-a-section" },
      ],
    };
    expect(describeOtherEditors(state, "self")).toEqual([]);
  });

  it("returns an empty list for an empty state", () => {
    expect(describeOtherEditors({}, "self")).toEqual([]);
  });
});
