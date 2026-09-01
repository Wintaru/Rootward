import { describe, expect, it } from "vitest";

import { formatSubmittedBirth } from "./access-requests";

describe("formatSubmittedBirth", () => {
  it("formats month + year", () => {
    expect(formatSubmittedBirth(3, 1990)).toBe("March 1990");
  });

  it("formats year only", () => {
    expect(formatSubmittedBirth(null, 1990)).toBe("1990");
  });

  it("formats month only", () => {
    expect(formatSubmittedBirth(3, null)).toBe("March");
  });

  it("returns null when neither was submitted", () => {
    expect(formatSubmittedBirth(null, null)).toBeNull();
  });

  it("ignores an out-of-range month and falls back to the year", () => {
    expect(formatSubmittedBirth(13, 1990)).toBe("1990");
    expect(formatSubmittedBirth(0, 1990)).toBe("1990");
  });

  it("ignores an out-of-range month with no year", () => {
    expect(formatSubmittedBirth(13, null)).toBeNull();
  });
});
