import { describe, expect, it } from "vitest";

import { readGedZip, readMediaEntries } from "./gedzip.ts";
import {
  archiveEntryNames,
  createGedZipStream,
  GEDZIP_GEDCOM_ENTRY,
  readStreamToBytes,
} from "./gedzip-write.ts";

const GEDCOM = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 TRLR\n";
const MTIME = new Date("2026-01-01T00:00:00Z");

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("createGedZipStream", () => {
  it("writes gedcom.ged first, then every entry, and the reader gets it all back", async () => {
    const reads: string[] = [];
    const stream = createGedZipStream(
      GEDCOM,
      [
        {
          name: "photo.jpg",
          read: () => {
            reads.push("photo.jpg");
            return Promise.resolve(bytes(0xff, 0xd8, 0xff, 0xd9));
          },
        },
        {
          name: "scan.pdf",
          read: () => {
            reads.push("scan.pdf");
            return Promise.resolve(bytes(0x25, 0x50, 0x44, 0x46));
          },
        },
      ],
      { mtime: MTIME },
    );
    const archive = await readStreamToBytes(stream);

    const contents = readGedZip(archive);
    expect(contents.gedcomEntryName).toBe(GEDZIP_GEDCOM_ENTRY);
    expect(contents.gedcomText).toBe(GEDCOM);
    expect(contents.mediaEntryNames).toEqual(["photo.jpg", "scan.pdf"]);
    expect(reads).toEqual(["photo.jpg", "scan.pdf"]);

    const media = readMediaEntries(archive, new Set(["photo.jpg", "scan.pdf"]));
    expect(media.get("photo.jpg")).toEqual(bytes(0xff, 0xd8, 0xff, 0xd9));
    expect(media.get("scan.pdf")).toEqual(bytes(0x25, 0x50, 0x44, 0x46));
  });

  it("is byte-stable for the same input and a fixed mtime", async () => {
    const make = () =>
      readStreamToBytes(
        createGedZipStream(
          GEDCOM,
          [{ name: "a.bin", read: () => Promise.resolve(bytes(1, 2, 3)) }],
          { mtime: MTIME },
        ),
      );
    expect(await make()).toEqual(await make());
  });

  it("reads at most one entry ahead of the consumer", async () => {
    const reads: number[] = [];
    const stream = createGedZipStream(
      GEDCOM,
      [0, 1, 2, 3].map((i) => ({
        name: `${i}.bin`,
        read: () => {
          reads.push(i);
          return Promise.resolve(bytes(i));
        },
      })),
    );
    // The default high-water mark is one chunk, so the stream may run one
    // pull ahead of each read -- never further, never the whole list.
    const reader = stream.getReader();
    await reader.read(); // the .ged
    expect(reads.length).toBeLessThanOrEqual(1);
    await reader.read();
    expect(reads.length).toBeLessThanOrEqual(2);
    await reader.cancel();
    expect(reads.length).toBeLessThan(4);
  });

  it("errors the stream when an entry cannot be read -- no partial archive", async () => {
    const stream = createGedZipStream(GEDCOM, [
      { name: "ok.bin", read: () => Promise.resolve(bytes(1)) },
      { name: "gone.bin", read: () => Promise.reject(new Error("404")) },
    ]);
    await expect(readStreamToBytes(stream)).rejects.toThrow("404");
  });

  it("an empty entry list is still a valid GedZip", async () => {
    const archive = await readStreamToBytes(createGedZipStream(GEDCOM, []));
    expect(readGedZip(archive).mediaEntryNames).toEqual([]);
  });
});

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

describe("archiveEntryNames", () => {
  it("uses the original basename whichever separator the source OS used", () => {
    const names = archiveEntryNames(
      [
        {
          id: "a",
          original_filename: "C:\\Users\\Jane\\photo.jpg",
          mime_type: "image/jpeg",
        },
        {
          id: "b",
          original_filename: "/home/bob/scans/deed.pdf",
          mime_type: "application/pdf",
        },
        { id: "c", original_filename: "plain.png", mime_type: "image/png" },
      ],
      EXT,
    );
    expect([...names.values()]).toEqual(["photo.jpg", "deed.pdf", "plain.png"]);
  });

  it("disambiguates a repeated basename with the row id, case-insensitively", () => {
    const names = archiveEntryNames(
      [
        {
          id: "11111111-aaaa",
          original_filename: "photo.jpg",
          mime_type: "image/jpeg",
        },
        {
          id: "22222222-bbbb",
          original_filename: "Photo.JPG",
          mime_type: "image/jpeg",
        },
        {
          id: "33333333-cccc",
          original_filename: "photo.jpg",
          mime_type: "image/jpeg",
        },
      ],
      EXT,
    );
    expect([...names.values()]).toEqual([
      "photo.jpg",
      "Photo-22222222.JPG",
      "photo-33333333.jpg",
    ]);
  });

  it("never emits a duplicate, even when a filename already looks like the id suffix", () => {
    const names = archiveEntryNames(
      [
        {
          id: "aaaa",
          original_filename: "photo-22222222.jpg",
          mime_type: null,
        },
        { id: "bbbb", original_filename: "photo.jpg", mime_type: null },
        {
          id: "22222222-cccc",
          original_filename: "photo.jpg",
          mime_type: null,
        },
      ],
      EXT,
    );
    expect(new Set(names.values()).size).toBe(3);
    expect(names.get("22222222-cccc")).toBe("photo-22222222-cccc.jpg");
  });

  it("falls back to the id and the MIME's extension when there is no usable filename", () => {
    const names = archiveEntryNames(
      [
        { id: "abc", original_filename: null, mime_type: "image/webp" },
        { id: "def", original_filename: "  ", mime_type: null },
        { id: "ghi", original_filename: "photos/..", mime_type: "image/png" },
        { id: "jkl", original_filename: ".", mime_type: null },
      ],
      EXT,
    );
    expect([...names.values()]).toEqual(["abc.webp", "def", "ghi.png", "jkl"]);
  });

  it("keeps gedcom.ged for the GEDCOM entry", () => {
    const names = archiveEntryNames(
      [{ id: "x", original_filename: "gedcom.ged", mime_type: null }],
      EXT,
    );
    expect(names.get("x")).toBe("gedcom-x.ged");
  });

  it("replaces characters a filesystem rejects", () => {
    const names = archiveEntryNames(
      [{ id: "x", original_filename: 'what?:"a<b>|c*.jpg', mime_type: null }],
      EXT,
    );
    expect(names.get("x")).toBe("what___a_b__c_.jpg");
  });
});
