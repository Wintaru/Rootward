import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { prepareImportUpload } from "./prepare-upload";

const text = (s: string) => new TextEncoder().encode(s);
const file = (bytes: Uint8Array<ArrayBufferLike>, name: string, type = "") =>
  new File([new Uint8Array(bytes)], name, { type });

describe("prepareImportUpload", () => {
  it("passes a plain .ged file through unchanged", async () => {
    const gedcom = "0 HEAD\n0 TRLR\n";
    const result = await prepareImportUpload(file(text(gedcom), "tree.ged"));

    expect(result.gedcomText).toBe(gedcom);
    expect(result.mediaFiles.size).toBe(0);
    expect(result.unsafePaths).toEqual([]);
  });

  it("unzips a GedZip into gedcom text and media bytes", async () => {
    const jane = text("fake-jpeg-bytes:jane");
    const archive = zipSync({
      "tree.ged": text("0 HEAD\n0 TRLR\n"),
      "media/jane.jpg": jane,
    });

    const result = await prepareImportUpload(file(archive, "Donner.zip"));

    expect(result.gedcomText).toBe("0 HEAD\n0 TRLR\n");
    expect(result.mediaFiles.get("media/jane.jpg")).toEqual(jane);
    expect(result.unsafePaths).toEqual([]);
  });

  it("drops an unsafe archive path instead of uploading it", async () => {
    const archive = zipSync({
      "tree.ged": text("0 HEAD\n0 TRLR\n"),
      "../escape.jpg": text("fake-jpeg-bytes:escape"),
      "media/jane.jpg": text("fake-jpeg-bytes:jane"),
    });

    const result = await prepareImportUpload(file(archive, "Donner.zip"));

    expect(result.mediaFiles.has("../escape.jpg")).toBe(false);
    expect(result.mediaFiles.has("media/jane.jpg")).toBe(true);
    expect(result.unsafePaths).toEqual(["../escape.jpg"]);
  });
});
