import { describe, expect, it } from "vitest";

import {
  decodeMediaStorageKey,
  encodeMediaStorageKey,
  isSafeArchivePath,
} from "./media-storage-keys.ts";

describe("isSafeArchivePath", () => {
  it("accepts an ordinary relative path", () => {
    expect(isSafeArchivePath("media/John Smith.jpg")).toBe(true);
  });

  it("rejects an empty path", () => {
    expect(isSafeArchivePath("")).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(isSafeArchivePath("/etc/passwd")).toBe(false);
  });

  it("rejects a .. segment anywhere in the path", () => {
    expect(isSafeArchivePath("../secrets.txt")).toBe(false);
    expect(isSafeArchivePath("media/../../secrets.txt")).toBe(false);
  });
});

describe("encodeMediaStorageKey / decodeMediaStorageKey", () => {
  it("round-trips an ordinary path", () => {
    const key = encodeMediaStorageKey(3, "media/John Smith.jpg");
    expect(decodeMediaStorageKey(key)).toEqual({
      index: 3,
      archivePath: "media/John Smith.jpg",
    });
  });

  it("round-trips unicode and special characters", () => {
    const path = "médias/Jöhn Smïth (1900–1980)_scan#1.jpg";
    const key = encodeMediaStorageKey(0, path);
    expect(decodeMediaStorageKey(key)).toEqual({ index: 0, archivePath: path });
  });

  it("splits on the first underscore only, even with an underscore in the path", () => {
    const key = encodeMediaStorageKey(12, "media/family_photo.jpg");
    expect(decodeMediaStorageKey(key)).toEqual({
      index: 12,
      archivePath: "media/family_photo.jpg",
    });
  });

  it("throws encoding an unsafe archive path", () => {
    expect(() => encodeMediaStorageKey(0, "../escape.jpg")).toThrow();
  });

  it("returns null decoding a key with no underscore", () => {
    expect(decodeMediaStorageKey("noSeparator")).toBeNull();
  });

  it("returns null decoding a key with a non-numeric index", () => {
    expect(decodeMediaStorageKey("abc_media%2Fjane.jpg")).toBeNull();
  });

  it("returns null decoding a key whose decoded path is unsafe", () => {
    const unsafeKey = `0_${encodeURIComponent("../escape.jpg")}`;
    expect(decodeMediaStorageKey(unsafeKey)).toBeNull();
  });
});
