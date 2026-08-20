import { createHash } from "node:crypto";

export type PaperNoteImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type PreparedPaperNoteImage = {
  detectedMimeType: PaperNoteImageMimeType;
  sha256: string;
  width: number | null;
  height: number | null;
};

export class PaperNoteImageError extends Error {
  constructor(public readonly code: "INVALID_IMAGE" | "IMAGE_TYPE_MISMATCH" | "IMAGE_TOO_LARGE", message: string) {
    super(message);
    this.name = "PaperNoteImageError";
  }
}

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 20_000;
const MAX_PIXELS = 80_000_000;

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function detectMime(bytes: Uint8Array): PaperNoteImageMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) break;
    const isSof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isSof && length >= 7) {
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      return { width, height };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk !== "VP8X") return null;
  const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
  const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
  return { width, height };
}

function dimensions(bytes: Uint8Array, mimeType: PaperNoteImageMimeType) {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

export async function preparePaperNoteImage(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
}): Promise<PreparedPaperNoteImage> {
  if (!input.bytes.length) throw new PaperNoteImageError("INVALID_IMAGE", "Image data is empty.");
  if (input.bytes.byteLength > MAX_BYTES) throw new PaperNoteImageError("IMAGE_TOO_LARGE", "Image is larger than 12 MB.");
  const detectedMimeType = detectMime(input.bytes);
  if (!detectedMimeType) throw new PaperNoteImageError("INVALID_IMAGE", "Use a JPEG, PNG, or WebP image.");
  if (input.declaredMimeType !== detectedMimeType) {
    throw new PaperNoteImageError("IMAGE_TYPE_MISMATCH", "The image type does not match its file contents.");
  }
  const size = dimensions(input.bytes, detectedMimeType);
  if (size && (size.width <= 0 || size.height <= 0 || size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS)) {
    throw new PaperNoteImageError("IMAGE_TOO_LARGE", "Image dimensions are too large to process safely.");
  }
  return {
    detectedMimeType,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}
