import { describe, expect, it } from "vitest";

import { MAX_GENERATIONS } from "@/lib/db";

import {
  type RawTreeSettingsInput,
  validateTreeSettingsForm,
} from "./tree-settings-form";

const PERSON = "11111111-2222-3333-4444-555555555555";

const VALID: RawTreeSettingsInput = {
  treeName: "  The Ashby Family  ",
  treeDescription: "  Nine generations, one town.  ",
  allowSelfSignup: true,
  livingThresholdYears: "100",
  defaultRootPersonId: PERSON.toUpperCase(),
  defaultGenerationsUp: "2",
  defaultGenerationsDown: "3",
  mediaMaxBytes: "10485760",
  mediaAllowedMime: "image/jpeg, image/png\nimage/jpeg\napplication/pdf",
  stripExifGps: false,
};

describe("validateTreeSettingsForm", () => {
  it("normalises a fully-populated form", () => {
    const result = validateTreeSettingsForm(VALID);
    expect(result).toEqual({
      ok: true,
      value: {
        treeName: "The Ashby Family",
        treeDescription: "Nine generations, one town.",
        allowSelfSignup: true,
        livingThresholdYears: 100,
        defaultRootPersonId: PERSON,
        defaultGenerationsUp: 2,
        defaultGenerationsDown: 3,
        mediaMaxBytes: 10485760,
        mediaAllowedMime: ["image/jpeg", "image/png", "application/pdf"],
        stripExifGps: false,
      },
    });
  });

  it("blanks name, description, and root person to null", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      treeName: "   ",
      treeDescription: "",
      defaultRootPersonId: "  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.treeName).toBeNull();
      expect(result.value.treeDescription).toBeNull();
      expect(result.value.defaultRootPersonId).toBeNull();
    }
  });

  it("rejects a living threshold below 1", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      livingThresholdYears: "0",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("living-person threshold"),
    });
  });

  it("rejects a non-numeric living threshold", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      livingThresholdYears: "abc",
    });
    expect(result.ok).toBe(false);
  });

  it(`rejects generations up/down past ${String(MAX_GENERATIONS)}`, () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      defaultGenerationsUp: String(MAX_GENERATIONS + 1),
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Generations up and down"),
    });
  });

  it("allows generations of exactly 0", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      defaultGenerationsUp: "0",
      defaultGenerationsDown: "0",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a negative or fractional generations value", () => {
    for (const value of ["-1", "1.5", ""]) {
      const result = validateTreeSettingsForm({
        ...VALID,
        defaultGenerationsUp: value,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a zero or negative media size", () => {
    for (const value of ["0", "-5"]) {
      const result = validateTreeSettingsForm({
        ...VALID,
        mediaMaxBytes: value,
      });
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("upload size"),
      });
    }
  });

  it("rejects an empty allowed-media-type list", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      mediaAllowedMime: "   \n  ,  ",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("MIME types"),
    });
  });

  it("rejects a malformed MIME entry", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      mediaAllowedMime: "image/jpeg, not-a-mime-type",
    });
    expect(result.ok).toBe(false);
  });

  it("de-dupes and lower-cases the MIME list", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      mediaAllowedMime: "Image/JPEG, image/jpeg",
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ mediaAllowedMime: ["image/jpeg"] }),
    });
  });

  it("rejects a default root person that is not a UUID", () => {
    const result = validateTreeSettingsForm({
      ...VALID,
      defaultRootPersonId: "not-a-uuid",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("root person"),
    });
  });
});
