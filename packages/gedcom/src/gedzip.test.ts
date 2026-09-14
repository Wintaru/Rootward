import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildMediaFileIndex,
  isZip,
  matchMediaFile,
  readGedZip,
  readMediaEntries,
} from "./gedzip.ts";

const text = (s: string) => new TextEncoder().encode(s);
const jpeg = (label: string) => text(`fake-jpeg-bytes:${label}`);

describe("isZip", () => {
  it("recognises the zip local-file-header signature", () => {
    const archive = zipSync({ "tree.ged": text("0 HEAD") });
    expect(isZip(archive)).toBe(true);
  });

  it("rejects plain GEDCOM text", () => {
    expect(isZip(text("0 HEAD\n1 SOUR Rootward\n"))).toBe(false);
  });

  it("rejects a too-short buffer", () => {
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe("readGedZip", () => {
  it("splits the .ged entry from the media entry names", () => {
    const archive = zipSync({
      "tree.ged": text("0 HEAD\n0 TRLR\n"),
      "media/jane.jpg": jpeg("jane"),
      "media/john.jpg": jpeg("john"),
    });

    const result = readGedZip(archive);

    expect(result.gedcomEntryName).toBe("tree.ged");
    expect(result.gedcomText).toBe("0 HEAD\n0 TRLR\n");
    expect([...result.mediaEntryNames].sort()).toEqual([
      "media/jane.jpg",
      "media/john.jpg",
    ]);
  });

  it("accepts a .gedcom extension and skips directory entries", () => {
    const archive = zipSync({
      "export.gedcom": text("0 HEAD\n0 TRLR\n"),
      "media/": new Uint8Array(0),
      "media/jane.jpg": jpeg("jane"),
    });

    const result = readGedZip(archive);

    expect(result.gedcomEntryName).toBe("export.gedcom");
    expect(result.mediaEntryNames).toEqual(["media/jane.jpg"]);
  });

  it("throws when the archive has no GEDCOM entry", () => {
    const archive = zipSync({ "media/jane.jpg": jpeg("jane") });
    expect(() => readGedZip(archive)).toThrow(/no \.ged\/\.gedcom entry/);
  });
});

describe("readMediaEntries", () => {
  it("decompresses only the requested paths", () => {
    const archive = zipSync({
      "tree.ged": text("0 HEAD\n0 TRLR\n"),
      "media/jane.jpg": jpeg("jane"),
      "media/john.jpg": jpeg("john"),
    });

    const result = readMediaEntries(archive, new Set(["media/jane.jpg"]));

    expect([...result.keys()]).toEqual(["media/jane.jpg"]);
    expect(result.get("media/jane.jpg")).toEqual(jpeg("jane"));
  });

  it("returns an empty map for an empty request without touching the archive", () => {
    const archive = zipSync({ "tree.ged": text("0 HEAD\n0 TRLR\n") });
    expect(readMediaEntries(archive, new Set()).size).toBe(0);
  });
});

describe("matchMediaFile", () => {
  const index = buildMediaFileIndex(["media/jane.jpg", "media/John Doe.jpg"]);
  const noClaims = () => new Set<string>();

  it("returns null for a null or empty path", () => {
    expect(matchMediaFile(null, index, noClaims())).toBeNull();
    expect(matchMediaFile("", index, noClaims())).toBeNull();
  });

  it("returns null for a URL instead of matching its tail filename", () => {
    expect(
      matchMediaFile("https://example.com/media/jane.jpg", index, noClaims()),
    ).toBeNull();
  });

  it("matches an exact zip-relative path", () => {
    const match = matchMediaFile("media/jane.jpg", index, noClaims());
    expect(match?.path).toBe("media/jane.jpg");
  });

  it("matches case-insensitively", () => {
    const match = matchMediaFile("Media/Jane.JPG", index, noClaims());
    expect(match?.path).toBe("media/jane.jpg");
  });

  it("normalises a Windows absolute path to its basename fallback", () => {
    const match = matchMediaFile(
      String.raw`C:\Users\jane\Photos\jane.jpg`,
      index,
      noClaims(),
    );
    expect(match?.path).toBe("media/jane.jpg");
  });

  it("falls back to basename when the directory does not match", () => {
    const match = matchMediaFile(
      "/some/other/path/John Doe.jpg",
      index,
      noClaims(),
    );
    expect(match?.path).toBe("media/John Doe.jpg");
  });

  it("refuses an ambiguous basename match", () => {
    const ambiguous = buildMediaFileIndex(["a/photo.jpg", "b/photo.jpg"]);
    expect(
      matchMediaFile("/elsewhere/photo.jpg", ambiguous, noClaims()),
    ).toBeNull();
  });

  it("returns null when nothing matches at all", () => {
    expect(matchMediaFile("media/missing.jpg", index, noClaims())).toBeNull();
  });

  it("does not let a second unrelated FILE value reuse a basename match", () => {
    // Two different people, same default camera filename in different
    // folders — the kind of collision a multi-contributor archive produces.
    const claimed = new Set<string>();
    const first = matchMediaFile(
      String.raw`C:\Users\Jane\Pictures\jane.jpg`,
      index,
      claimed,
    );
    expect(first?.path).toBe("media/jane.jpg");

    const second = matchMediaFile(
      String.raw`C:\Users\Bob\Pictures\jane.jpg`,
      index,
      claimed,
    );
    expect(second).toBeNull();
  });

  it("still allows two records to share an unambiguous exact match", () => {
    // Unlike the basename guess above, an explicit path match is not a
    // guess — a photo two records both name outright is not a collision.
    const claimed = new Set<string>();
    const first = matchMediaFile("media/jane.jpg", index, claimed);
    const second = matchMediaFile("media/jane.jpg", index, claimed);
    expect(first?.path).toBe("media/jane.jpg");
    expect(second?.path).toBe("media/jane.jpg");
  });
});
