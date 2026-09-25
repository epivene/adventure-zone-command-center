import { createHash } from "node:crypto";
import { z } from "zod";
import {
  GoogleCloudPrivateObjectStorage,
  type PrivateObjectStorage,
} from "../../lib/private-object-storage";
import { preparePaperNoteImage } from "../paper-notes/paper-note-image";
import type { AttachmentScope, Queryable, Screenshot } from "./contracts";
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const uuid = z.string().uuid().toLowerCase();
const metadata = (r: any): Screenshot => ({
  id: r.id,
  filename: r.filename,
  contentType: r.content_type,
  byteSize: r.byte_size,
  sha256: r.sha256,
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function validate(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > MAX_SCREENSHOT_BYTES)
    throw new Error("ASSISTANT_SCREENSHOT_SIZE_INVALID");
  try {
    const image = await preparePaperNoteImage({
      bytes,
      declaredMimeType: mime,
    });
    // Reject incomplete containers before asking the provider to decode pixels.
    if (mime === "image/png") {
      if (
        bytes.length < 33 ||
        bytes.toString("ascii", 12, 16) !== "IHDR" ||
        bytes.readUInt32BE(8) !== 13
      )
        throw new Error("invalid");
      let offset = 8,
        ended = false,
        pixels = false;
      while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset),
          kind = bytes.toString("ascii", offset + 4, offset + 8);
        if (offset + length + 12 > bytes.length || kind === "acTL")
          throw new Error("invalid");
        if (kind === "IDAT" && length > 0) pixels = true;
        if (
          crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
          bytes.readUInt32BE(offset + 8 + length)
        )
          throw new Error("invalid");
        offset += length + 12;
        if (kind === "IEND") {
          ended = length === 0 && offset === bytes.length;
          break;
        }
      }
      if (!ended || !pixels || !image.width || !image.height)
        throw new Error("invalid");
    } else if (mime === "image/jpeg") {
      if (
        !image.width ||
        !image.height ||
        bytes.at(-2) !== 0xff ||
        bytes.at(-1) !== 0xd9 ||
        bytes.indexOf(Buffer.from([0xff, 0xda]), 2) < 0
      )
        throw new Error("invalid");
    } else {
      if (bytes.length < 30 || bytes.readUInt32LE(4) + 8 !== bytes.length)
        throw new Error("invalid");
      let offset = 12,
        pixels = false;
      while (offset + 8 <= bytes.length) {
        const kind = bytes.toString("ascii", offset, offset + 4),
          length = bytes.readUInt32LE(offset + 4),
          start = offset + 8;
        if (start + length > bytes.length || kind === "ANIM" || kind === "ANMF")
          throw new Error("invalid");
        let width = 0,
          height = 0;
        if (kind === "VP8X") {
          if (offset !== 12 || length !== 10 || bytes[start] & 2)
            throw new Error("invalid");
          width = bytes.readUIntLE(start + 4, 3) + 1;
          height = bytes.readUIntLE(start + 7, 3) + 1;
        } else if (kind === "VP8 ") {
          if (
            length <= 10 ||
            bytes[start] & 1 ||
            bytes.toString("hex", start + 3, start + 6) !== "9d012a"
          )
            throw new Error("invalid");
          width = bytes.readUInt16LE(start + 6) & 0x3fff;
          height = bytes.readUInt16LE(start + 8) & 0x3fff;
          pixels = true;
        } else if (kind === "VP8L") {
          if (length <= 5 || bytes[start] !== 0x2f) throw new Error("invalid");
          const bits = bytes.readUInt32LE(start + 1);
          if (bits >>> 29) throw new Error("invalid");
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
          pixels = true;
        }
        if (
          ["VP8X", "VP8 ", "VP8L"].includes(kind) &&
          (!width ||
            !height ||
            width > 20000 ||
            height > 20000 ||
            width * height > 80000000)
        )
          throw new Error("invalid");
        offset = start + length + (length % 2);
      }
      if (!pixels || offset !== bytes.length) throw new Error("invalid");
    }
    return image;
  } catch {
    throw new Error("ASSISTANT_SCREENSHOT_INVALID");
  }
}

export class ScreenshotStore {
  constructor(
    private readonly db: Queryable,
    private readonly storage: () => Pick<
      PrivateObjectStorage,
      "put" | "get"
    > = () => new GoogleCloudPrivateObjectStorage(),
  ) {}
  async upload(
    actor: string,
    conversationId: string,
    id: string,
    filename: string,
    mime: string,
    bytes: Buffer,
  ): Promise<Screenshot> {
    uuid.parse(id);
    uuid.parse(conversationId);
    const owner = await this.db.query(
      "SELECT id FROM assistant_workspace_conversations WHERE id=$1 AND actor_id=$2",
      [conversationId, actor],
    );
    if (!owner.rows[0]) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
    const image = await validate(bytes, mime);
    const name =
      filename
        .replace(/[\x00-\x1f\x7f/\\]/g, "_")
        .slice(0, 160)
        .trim() || "Screenshot";
    const key = `assistant-workspace/${conversationId}/${id}/${image.sha256}`;
    await this.db.query(
      `INSERT INTO assistant_workspace_screenshots(id,conversation_id,actor_id,filename,content_type,byte_size,sha256,object_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
      [id, conversationId, actor, name, mime, bytes.length, image.sha256, key],
    );
    const rows = await this.db.query(
      "SELECT * FROM assistant_workspace_screenshots WHERE id=$1 AND conversation_id=$2 AND actor_id=$3",
      [id, conversationId, actor],
    );
    const saved = rows.rows[0];
    if (
      !saved ||
      saved.sha256 !== image.sha256 ||
      saved.filename !== name ||
      saved.content_type !== mime ||
      saved.byte_size !== bytes.length
    )
      throw new Error("ASSISTANT_SCREENSHOT_CONFLICT");
    if (!saved.ready) {
      try {
        await this.storage().put(saved.object_key, bytes, mime);
      } catch {
        throw new Error("ASSISTANT_SCREENSHOT_UPLOAD_FAILED");
      }
      // Concurrent retries can only write identical bytes to this immutable key.
      await this.db.query(
        "UPDATE assistant_workspace_screenshots SET ready=true WHERE id=$1 AND actor_id=$2",
        [id, actor],
      );
    }
    return metadata(saved);
  }
  private async row(
    actor: string,
    conversationId: string,
    id: string,
    sourceMessageId?: string,
  ) {
    const rows = await this.db.query(
      `SELECT a.* FROM assistant_workspace_screenshots a
      WHERE a.id=$1 AND a.conversation_id=$2 AND a.actor_id=$3 AND a.ready=true
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM assistant_workspace_messages m JOIN assistant_workspace_messages source
          ON source.id=$4 AND source.actor_id=m.actor_id AND source.conversation_id=m.conversation_id AND source.role='user'
        WHERE m.actor_id=a.actor_id AND m.conversation_id=a.conversation_id AND m.role='user'
          AND m.sequence<=source.sequence AND m.attachments @> jsonb_build_array(jsonb_build_object('id',a.id::text))
      ))`,
      [id, conversationId, actor, sourceMessageId ?? null],
    );
    if (!rows.rows[0]) throw new Error("ASSISTANT_SCREENSHOT_NOT_FOUND");
    return rows.rows[0];
  }
  async metadataForSend(actor: string, conversationId: string, ids: string[]) {
    z.array(uuid)
      .max(4)
      .refine((x) => new Set(x).size === x.length)
      .parse(ids);
    return Promise.all(
      ids.map(async (id) =>
        metadata(await this.row(actor, conversationId, id)),
      ),
    );
  }
  async metadataForModel(scope: AttachmentScope, id: string) {
    return metadata(
      await this.row(
        scope.actorId,
        scope.conversationId,
        id,
        scope.sourceMessageId,
      ),
    );
  }
  async read(
    actor: string,
    conversationId: string,
    id: string,
    sourceMessageId?: string,
  ) {
    const r = await this.row(actor, conversationId, id, sourceMessageId);
    let bytes: Uint8Array;
    try {
      bytes = await this.storage().get(r.object_key);
    } catch {
      throw new Error("ASSISTANT_SCREENSHOT_READ_FAILED");
    }
    if (
      bytes.length !== r.byte_size ||
      createHash("sha256").update(bytes).digest("hex") !== r.sha256
    )
      throw new Error("ASSISTANT_SCREENSHOT_CHANGED");
    return { attachment: metadata(r), bytes };
  }
  readForModel(scope: AttachmentScope, id: string) {
    return this.read(
      scope.actorId,
      scope.conversationId,
      id,
      scope.sourceMessageId,
    );
  }
}
