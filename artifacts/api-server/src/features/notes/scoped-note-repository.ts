import { and, desc, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { eventFamilies, organizationLocations, scopedNotes } from "@/db/schema";

export type ScopedNoteOwner =
  | { kind: "organization_location"; id: string }
  | { kind: "event_family"; id: string };

export type ScopedNoteRecord = {
  id: string;
  body: string;
  ownerKind: ScopedNoteOwner["kind"];
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScopedNoteMutationResult =
  | { ok: true; note: ScopedNoteRecord }
  | { ok: false; code: "OWNER_NOT_FOUND" | "NOT_FOUND" };

export type ScopedNoteDeleteResult =
  | { ok: true }
  | { ok: false; code: "OWNER_NOT_FOUND" | "NOT_FOUND" };

type DrizzleDatabase = typeof database;

function ownerColumn(owner: ScopedNoteOwner) {
  return owner.kind === "organization_location"
    ? scopedNotes.organizationLocationId
    : scopedNotes.eventFamilyId;
}

function toRecord(row: typeof scopedNotes.$inferSelect, owner: ScopedNoteOwner): ScopedNoteRecord {
  return {
    id: row.id,
    body: row.body,
    ownerKind: owner.kind,
    ownerId: owner.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ScopedNoteRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async ownerExists(owner: ScopedNoteOwner): Promise<boolean> {
    if (owner.kind === "organization_location") {
      const [row] = await this.database
        .select({ id: organizationLocations.id })
        .from(organizationLocations)
        .where(eq(organizationLocations.id, owner.id))
        .limit(1);
      return Boolean(row);
    }
    const [row] = await this.database
      .select({ id: eventFamilies.id })
      .from(eventFamilies)
      .where(eq(eventFamilies.id, owner.id))
      .limit(1);
    return Boolean(row);
  }

  async list(owner: ScopedNoteOwner): Promise<ScopedNoteRecord[]> {
    const rows = await this.database
      .select()
      .from(scopedNotes)
      .where(eq(ownerColumn(owner), owner.id))
      .orderBy(desc(scopedNotes.createdAt), desc(scopedNotes.id));
    return rows.map((row) => toRecord(row, owner));
  }

  async create(owner: ScopedNoteOwner, body: string, now = new Date()): Promise<ScopedNoteMutationResult> {
    if (!(await this.ownerExists(owner))) return { ok: false, code: "OWNER_NOT_FOUND" };
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, code: "NOT_FOUND" };
    const [row] = await this.database
      .insert(scopedNotes)
      .values({
        organizationLocationId: owner.kind === "organization_location" ? owner.id : null,
        eventFamilyId: owner.kind === "event_family" ? owner.id : null,
        body: trimmed,
        source: "local",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Could not create note");
    return { ok: true, note: toRecord(row, owner) };
  }

  async update(owner: ScopedNoteOwner, noteId: string, body: string, now = new Date()): Promise<ScopedNoteMutationResult> {
    if (!(await this.ownerExists(owner))) return { ok: false, code: "OWNER_NOT_FOUND" };
    const [row] = await this.database
      .update(scopedNotes)
      .set({ body: body.trim(), updatedAt: now })
      .where(and(eq(scopedNotes.id, noteId), eq(ownerColumn(owner), owner.id)))
      .returning();
    return row ? { ok: true, note: toRecord(row, owner) } : { ok: false, code: "NOT_FOUND" };
  }

  async remove(owner: ScopedNoteOwner, noteId: string): Promise<ScopedNoteDeleteResult> {
    if (!(await this.ownerExists(owner))) return { ok: false, code: "OWNER_NOT_FOUND" };
    const [row] = await this.database
      .delete(scopedNotes)
      .where(and(eq(scopedNotes.id, noteId), eq(ownerColumn(owner), owner.id)))
      .returning({ id: scopedNotes.id });
    return row ? { ok: true } : { ok: false, code: "NOT_FOUND" };
  }
}
