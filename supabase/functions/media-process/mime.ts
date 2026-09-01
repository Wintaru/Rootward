/**
 * Magic-byte MIME sniffing for uploaded media (SPEC §7 `media-process`, issue
 * #33). The client-declared MIME is never trusted for the allowlist check --
 * only the bytes are. Pure, no I/O.
 */

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

export function sniffMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a"))
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    matchesAscii(bytes, 0, "RIFF") &&
    matchesAscii(bytes, 8, "WEBP")
  ) {
    return "image/webp";
  }
  if (bytes.length >= 5 && matchesAscii(bytes, 0, "%PDF-")) {
    return "application/pdf";
  }
  if (bytes.length >= 12 && matchesAscii(bytes, 4, "ftyp")) {
    const brand = asciiAt(bytes, 8, 4).replace(/\0/g, "").trim().toLowerCase();
    if (HEIC_BRANDS.has(brand)) {
      return "image/heic";
    }
  }
  return null;
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  text: string,
): boolean {
  if (offset + text.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
