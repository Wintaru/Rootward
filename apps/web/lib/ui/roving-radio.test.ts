import { describe, expect, it } from "vitest";

import { nextRadioIndex } from "./roving-radio";

describe("nextRadioIndex", () => {
  it("steps forward and back with wrap-around", () => {
    expect(nextRadioIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextRadioIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("jumps to the ends", () => {
    expect(nextRadioIndex("Home", 2, 3)).toBe(0);
    expect(nextRadioIndex("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and an empty group", () => {
    expect(nextRadioIndex("Enter", 1, 3)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
