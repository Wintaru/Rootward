import { assertEquals, assertExists } from "@std/assert";

import {
  type DecodedImage,
  type ExifResult,
  type ExifTools,
  type ImageCodec,
  type MediaLinkInsert,
  type MediaProcessGateway,
  type MediaRowInsert,
  runMediaProcess,
  type TreeMediaSettings,
} from "./processor.ts";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);
const HEIC_BYTES = new Uint8Array([
  0,
  0,
  0,
  0,
  0x66,
  0x74,
  0x79,
  0x70,
  0x68,
  0x65,
  0x69,
  0x63,
]);
const GIF_BYTES = new TextEncoder().encode("GIF89a...");
const BOGUS_BYTES = new TextEncoder().encode("not an image at all");

const DEFAULT_SETTINGS: TreeMediaSettings = {
  mediaMaxBytes: 10 * 1024 * 1024,
  mediaAllowedMime: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "application/pdf",
  ],
  stripExifGps: true,
};

const DECODED: DecodedImage = {
  width: 400,
  height: 300,
  data: new Uint8ClampedArray(400 * 300 * 4),
};

interface FakeState {
  readonly objects: Map<string, Uint8Array>;
  readonly removed: string[];
  readonly media: MediaRowInsert[];
  readonly links: MediaLinkInsert[];
  stripCalls: number;
  decodeCalls: number;
}

function createFakeGateway(
  state: FakeState,
  settings: TreeMediaSettings = DEFAULT_SETTINGS,
): MediaProcessGateway {
  return {
    loadTreeSettings: () => Promise.resolve(settings),
    readObject: (path) => {
      const bytes = state.objects.get(path);
      if (bytes === undefined) {
        throw new Error(`no fake object at ${path}`);
      }
      return Promise.resolve(bytes);
    },
    writeObject: (path, bytes) => {
      state.objects.set(path, bytes);
      return Promise.resolve();
    },
    removeObject: (path) => {
      state.removed.push(path);
      state.objects.delete(path);
      return Promise.resolve();
    },
    insertMedia: (row) => {
      state.media.push(row);
      return Promise.resolve();
    },
    insertMediaLink: (link) => {
      state.links.push(link);
      return Promise.resolve();
    },
  };
}

function createFakeCodec(state: FakeState, supportsHeic = true): ImageCodec {
  return {
    decode: (_bytes, mimeType) => {
      state.decodeCalls++;
      if (
        mimeType === "image/jpeg" ||
        mimeType === "image/png" ||
        mimeType === "image/webp"
      ) {
        return Promise.resolve(DECODED);
      }
      if (mimeType === "image/heic" && supportsHeic) {
        return Promise.resolve(DECODED);
      }
      return Promise.resolve(null);
    },
    encodeWebp: (_image, maxDimension) =>
      Promise.resolve(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, maxDimension & 0xff]),
      ),
  };
}

function createFakeExif(
  state: FakeState,
  result: ExifResult = { dateTaken: null, hasGps: false },
): ExifTools {
  return {
    read: () => Promise.resolve(result),
    stripGps: (bytes) => {
      state.stripCalls++;
      return Promise.resolve({
        bytes: new Uint8Array([...bytes, 0xee]),
        stripped: true,
      });
    },
  };
}

function newState(): FakeState {
  return {
    objects: new Map(),
    removed: [],
    media: [],
    links: [],
    stripCalls: 0,
    decodeCalls: 0,
  };
}

function stagePath(
  state: FakeState,
  bytes: Uint8Array,
  path = "staging/upload-1.jpg",
): string {
  state.objects.set(path, bytes);
  return path;
}

const BASE_INPUT = {
  ownerType: "person" as const,
  ownerId: "d0000000-0000-0000-0000-000000000001",
  originalFilename: "photo.jpg",
  uploadedBy: "a0000000-0000-0000-0000-000000000001",
};

Deno.test(
  "runMediaProcess: JPEG with GPS -> stripped original + both derivatives + date",
  async () => {
    const state = newState();
    const staging = stagePath(state, JPEG_BYTES);
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging },
      {
        gateway: createFakeGateway(state),
        codec: createFakeCodec(state),
        exif: createFakeExif(state, { dateTaken: "2020-05-14", hasGps: true }),
        newId: () => "m1",
      },
    );

    assertEquals(outcome, {
      status: "processed",
      mediaId: "m1",
      hasDerivatives: true,
      warnings: [],
    });
    assertEquals(state.stripCalls, 1);
    assertEquals(state.objects.has("m1/original.jpg"), true);
    assertEquals(
      state.objects.get("m1/original.jpg"),
      new Uint8Array([...JPEG_BYTES, 0xee]),
    );
    assertEquals(state.objects.has("m1/thumb.webp"), true);
    assertEquals(state.objects.has("m1/display.webp"), true);
    assertEquals(state.removed, [staging]);

    assertEquals(state.media.length, 1);
    const row = state.media[0];
    assertEquals(row.mimeType, "image/jpeg");
    assertEquals(row.storagePathThumb, "m1/thumb.webp");
    assertEquals(row.storagePathDisplay, "m1/display.webp");
    assertEquals(row.exif, { hasGps: true, gpsStripped: true });
    assertExists(row.date);
    assertEquals(row.date?.date_year1, 2020);

    assertEquals(state.links, [
      { mediaId: "m1", ownerType: "person", ownerId: BASE_INPUT.ownerId },
    ]);
  },
);

Deno.test(
  "runMediaProcess: PNG with no EXIF -> no strip call, no date",
  async () => {
    const state = newState();
    const staging = stagePath(state, PNG_BYTES, "staging/upload-2.png");
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging, originalFilename: "scan.png" },
      {
        gateway: createFakeGateway(state),
        codec: createFakeCodec(state),
        exif: createFakeExif(state),
        newId: () => "m2",
      },
    );

    assertEquals(outcome.status, "processed");
    assertEquals(state.stripCalls, 0);
    assertEquals(state.objects.get("m2/original.png"), PNG_BYTES);
    assertEquals(state.media[0].date, null);
  },
);

Deno.test("runMediaProcess: HEIC -> both WebP derivatives", async () => {
  const state = newState();
  const staging = stagePath(state, HEIC_BYTES, "staging/upload-3.heic");
  const outcome = await runMediaProcess(
    { ...BASE_INPUT, stagingPath: staging, originalFilename: "photo.heic" },
    {
      gateway: createFakeGateway(state),
      codec: createFakeCodec(state),
      exif: createFakeExif(state),
      newId: () => "m3",
    },
  );

  assertEquals(outcome, {
    status: "processed",
    mediaId: "m3",
    hasDerivatives: true,
    warnings: [],
  });
  assertEquals(state.media[0].mimeType, "image/heic");
  assertEquals(state.media[0].storagePathOriginal, "m3/original.heic");
});

Deno.test(
  "runMediaProcess: a format with no derivative codec (GIF) stores the original only",
  async () => {
    const state = newState();
    const staging = stagePath(state, GIF_BYTES, "staging/upload-4.gif");
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging, originalFilename: "clip.gif" },
      {
        gateway: createFakeGateway(state),
        codec: createFakeCodec(state),
        exif: createFakeExif(state),
        newId: () => "m4",
      },
    );

    assertEquals(outcome.status, "processed");
    if (outcome.status === "processed") {
      assertEquals(outcome.hasDerivatives, false);
      assertEquals(outcome.warnings.length, 1);
    }
    assertEquals(state.media[0].storagePathThumb, null);
    assertEquals(state.media[0].storagePathDisplay, null);
    assertEquals(state.objects.has("m4/original.gif"), true);
  },
);

Deno.test(
  "runMediaProcess: oversized upload is rejected and staging is cleaned up",
  async () => {
    const state = newState();
    const staging = stagePath(state, JPEG_BYTES);
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging },
      {
        gateway: createFakeGateway(state, {
          ...DEFAULT_SETTINGS,
          mediaMaxBytes: 4,
        }),
        codec: createFakeCodec(state),
        exif: createFakeExif(state),
        newId: () => "m5",
      },
    );

    assertEquals(outcome, { status: "rejected", reason: "size" });
    assertEquals(state.removed, [staging]);
    assertEquals(state.media.length, 0);
    assertEquals(state.links.length, 0);
  },
);

Deno.test(
  "runMediaProcess: a disallowed MIME is rejected even though the bytes sniff cleanly",
  async () => {
    const state = newState();
    const staging = stagePath(state, JPEG_BYTES);
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging },
      {
        gateway: createFakeGateway(state, {
          ...DEFAULT_SETTINGS,
          mediaAllowedMime: ["image/png"],
        }),
        codec: createFakeCodec(state),
        exif: createFakeExif(state),
        newId: () => "m6",
      },
    );

    assertEquals(outcome, { status: "rejected", reason: "mime" });
    assertEquals(state.removed, [staging]);
  },
);

Deno.test(
  "runMediaProcess: unrecognized bytes are rejected as an unknown MIME",
  async () => {
    const state = newState();
    const staging = stagePath(state, BOGUS_BYTES);
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging },
      {
        gateway: createFakeGateway(state),
        codec: createFakeCodec(state),
        exif: createFakeExif(state),
        newId: () => "m7",
      },
    );

    assertEquals(outcome, { status: "rejected", reason: "mime" });
  },
);

Deno.test(
  "runMediaProcess: stripExifGps=false never strips, even with GPS present",
  async () => {
    const state = newState();
    const staging = stagePath(state, JPEG_BYTES);
    await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging },
      {
        gateway: createFakeGateway(state, {
          ...DEFAULT_SETTINGS,
          stripExifGps: false,
        }),
        codec: createFakeCodec(state),
        exif: createFakeExif(state, { dateTaken: null, hasGps: true }),
        newId: () => "m8",
      },
    );

    assertEquals(state.stripCalls, 0);
    assertEquals(state.objects.get("m8/original.jpg"), JPEG_BYTES);
    assertEquals(state.media[0].exif, { hasGps: true, gpsStripped: false });
  },
);

Deno.test(
  "runMediaProcess: a MIME the tooling can't edit reports gpsStripped=false, not a false positive",
  async () => {
    const state = newState();
    const staging = stagePath(
      state,
      HEIC_BYTES,
      "staging/upload-heic-gps.heic",
    );
    const exif: ExifTools = {
      read: () => Promise.resolve({ dateTaken: null, hasGps: true }),
      // Mirrors the real exif.ts: image/heic can't be edited in place, so
      // stripGps reports stripped: false and hands the bytes back untouched.
      stripGps: (bytes) => Promise.resolve({ bytes, stripped: false }),
    };
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging, originalFilename: "photo.heic" },
      {
        gateway: createFakeGateway(state),
        codec: createFakeCodec(state),
        exif,
        newId: () => "m8b",
      },
    );

    // The bytes are untouched -- the original still carries the GPS data --
    // and the DB record must not claim otherwise.
    assertEquals(state.objects.get("m8b/original.heic"), HEIC_BYTES);
    assertEquals(state.media[0].exif, { hasGps: true, gpsStripped: false });
    if (outcome.status === "processed") {
      assertEquals(
        outcome.warnings.some((w) => w.includes("could not be stripped")),
        true,
      );
    }
  },
);

Deno.test(
  "runMediaProcess: a codec failure degrades to original-only instead of failing the upload",
  async () => {
    const state = newState();
    const staging = stagePath(state, JPEG_BYTES);
    const codec: ImageCodec = {
      decode: () => Promise.reject(new Error("corrupt image data")),
      encodeWebp: () => Promise.reject(new Error("unreachable")),
    };
    const outcome = await runMediaProcess(
      { ...BASE_INPUT, stagingPath: staging },
      {
        gateway: createFakeGateway(state),
        codec,
        exif: createFakeExif(state),
        newId: () => "m9",
      },
    );

    assertEquals(outcome.status, "processed");
    if (outcome.status === "processed") {
      assertEquals(outcome.hasDerivatives, false);
      assertEquals(outcome.warnings.length, 1);
      assertEquals(outcome.warnings[0].includes("corrupt image data"), true);
    }
    assertEquals(state.objects.has("m9/original.jpg"), true);
    assertEquals(state.media.length, 1);
  },
);
