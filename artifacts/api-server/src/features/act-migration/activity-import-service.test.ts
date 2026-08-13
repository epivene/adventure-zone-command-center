/**
 * Unit tests for ActMigrationActivityImportService.
 *
 * Covers:
 * - Projected-to-plain query mode fallback
 * - Fetch failure isolation (one stream fails, others continue)
 * - Persistence: new row inserted vs conflict-suppressed skip
 * - Booking association via opportunity link
 * - Plain-mode association: direct ID field extraction
 * - Plain-mode association: relationship-endpoint fallback when no inline data
 */

import { describe, expect, it, vi } from "vitest";
import type { ActMigrationSourceClient } from "@/features/act-migration/source-client";
import { ActMigrationActivityImportService } from "@/features/act-migration/activity-import-service";

// ─── Minimal fakes ────────────────────────────────────────────────────────────

type Page = { items: unknown[]; nextSkip: number | null; queryMode: string };

function emptyPage(queryMode = "projected"): Page {
  return { items: [], nextSkip: null, queryMode };
}

/** A raw note item (projected mode — contact expanded as nested object). */
function rawNote(id: string, contactActId = "contact-1") {
  return {
    id,
    subject: `Note ${id}`,
    body: "Body text",
    createDate: "2024-01-15T10:00:00Z",
    contact: { id: contactActId, fullName: "Alice" },
    company: null,
    opportunity: null,
  };
}

/** A raw note with no inline associations — simulates plain-mode with direct FK. */
function rawNotePlainDirect(id: string, contactId: string) {
  return {
    id,
    subject: `Note ${id}`,
    body: "Body text",
    createDate: "2024-01-15T10:00:00Z",
    // No nested contact/company/opportunity objects
    contactId, // plain-mode direct foreign key
  };
}

/** A raw note with absolutely no association fields — requires relationship endpoint. */
function rawNotePlainOrphan(id: string) {
  return {
    id,
    subject: `Note ${id}`,
    body: "Body text",
    createDate: "2024-01-15T10:00:00Z",
    // No contact, contactId, company, opportunity — endpoint fallback needed
  };
}

/** Build a full ActMigrationSourceClient mock (all methods return empty pages). */
function makeClient(overrides: Partial<ActMigrationSourceClient> = {}): ActMigrationSourceClient {
  const noPage = vi.fn().mockResolvedValue(emptyPage());
  return {
    listActivities: vi.fn().mockResolvedValue(emptyPage()),
    listNotes: vi.fn().mockResolvedValue(emptyPage()),
    listHistory: vi.fn().mockResolvedValue(emptyPage()),
    listCompanies: noPage,
    listContacts: noPage,
    listOpportunities: noPage,
    listGroups: noPage,
    listCompaniesForContact: noPage,
    listNotesForContact: noPage,
    listCompaniesForOpportunity: noPage,
    listContactsForOpportunity: noPage,
    listContactsForGroup: noPage,
    // per-record relationship endpoints
    listContactsForNote: noPage,
    listCompaniesForNote: noPage,
    listContactsForHistory: noPage,
    listCompaniesForHistory: noPage,
    listContactsForActivity: noPage,
    listCompaniesForActivity: noPage,
    ...overrides,
  };
}

/**
 * Build a simple DB mock.
 * - select().from().where().limit() resolves to `selectRows`
 * - insert().values().onConflictDoNothing().returning() resolves to `insertedRows`
 */
function makeDb(options: {
  selectRows?: { entityId: string }[];
  insertedRows?: { id: string }[];
} = {}) {
  const { selectRows = [], insertedRows = [] } = options;

  const limitMock = vi.fn().mockResolvedValue(selectRows);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });

  const returningMock = vi.fn().mockResolvedValue(insertedRows);
  const onConflictMock = vi.fn().mockReturnValue({ returning: returningMock });
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

  return {
    db: { select: selectMock, insert: insertMock } as never,
    limitMock,
    valuesMock,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ActMigrationActivityImportService", () => {
  describe("projected-to-plain fallback", () => {
    it("retries the first page in plain mode when the endpoint signals a fallback", async () => {
      const noteId = "note-abc";
      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [], nextSkip: 0, queryMode: "plain" })
        .mockResolvedValueOnce({ items: [rawNote(noteId)], nextSkip: null, queryMode: "plain" });

      const client = makeClient({ listNotes });
      const { db, limitMock } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-uuid" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(listNotes).toHaveBeenCalledTimes(2);
      expect(listNotes.mock.calls[0]![0]).toMatchObject({ queryMode: "projected" });
      expect(listNotes.mock.calls[1]![0]).toMatchObject({ queryMode: "plain" });
      expect(result.note.inserted).toBe(1);
      expect(result.errorMessage).toBeUndefined();
    });

    it("does not stall when the plain-mode page is also empty", async () => {
      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [], nextSkip: 0, queryMode: "plain" })
        .mockResolvedValueOnce({ items: [], nextSkip: null, queryMode: "plain" });

      const client = makeClient({ listNotes });
      const { db } = makeDb();

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(listNotes).toHaveBeenCalledTimes(2);
      expect(result.note.inserted).toBe(0);
    });
  });

  describe("fetch failure handling", () => {
    it("captures an API throw on one stream in errorMessage without aborting others", async () => {
      const listNotes = vi.fn().mockRejectedValue(new Error("API unavailable"));
      const client = makeClient({ listNotes });
      const { db } = makeDb();

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.errorMessage).toMatch(/note/);
      expect(result.errorMessage).toMatch(/API unavailable/);
      expect(result.history.inserted).toBe(0);
      expect(result.activity.inserted).toBe(0);
    });

    it("still processes later streams after an earlier stream fails", async () => {
      const listNotes = vi.fn().mockRejectedValue(new Error("notes broken"));
      const historyItem = {
        id: "hist-1", subject: "Call recap", details: "Discussed pricing",
        createDate: "2024-03-01T09:00:00Z",
        contact: { id: "contact-1", fullName: "Bob" },
        company: null, opportunity: null,
      };
      const listHistory = vi.fn()
        .mockResolvedValueOnce({ items: [historyItem], nextSkip: null, queryMode: "projected" });

      const client = makeClient({ listNotes, listHistory });
      const { db } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-uuid" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.errorMessage).toMatch(/note/);
      expect(result.history.inserted).toBe(1);
    });
  });

  describe("persistence and idempotency", () => {
    it("counts as inserted when the DB row is new", async () => {
      const listNotes = vi.fn().mockResolvedValueOnce({
        items: [rawNote("note-1")], nextSkip: null, queryMode: "projected",
      });
      const client = makeClient({ listNotes });
      const { db } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-new" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.inserted).toBe(1);
      expect(result.note.skipped).toBe(0);
    });

    it("counts as skipped when onConflictDoNothing suppresses the duplicate", async () => {
      const listNotes = vi.fn().mockResolvedValueOnce({
        items: [rawNote("note-dup")], nextSkip: null, queryMode: "projected",
      });
      const client = makeClient({ listNotes });
      const { db } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [],   // empty → conflict suppressed
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.inserted).toBe(0);
      expect(result.note.skipped).toBe(1);
    });

    it("counts as unlinked when no local entity matches", async () => {
      const listNotes = vi.fn().mockResolvedValueOnce({
        items: [rawNote("note-orphan", "unknown-act-contact-id")],
        nextSkip: null, queryMode: "projected",
      });
      const client = makeClient({ listNotes });
      const { db } = makeDb({ selectRows: [] }); // resolveLocalId returns null

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.inserted).toBe(0);
      expect(result.note.skipped).toBe(0);
      expect(result.note.unlinked).toBe(1);
    });
  });

  describe("plain-mode association: direct ID field extraction", () => {
    it("uses contactId direct field when nested contact object is absent", async () => {
      // Real source-client protocol: fallback is always signalled by an empty
      // projected-mode first page (queryMode: "plain"), then the second call
      // (now in plain mode) returns the actual items.
      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [], nextSkip: 0, queryMode: "plain" })  // fallback signal
        .mockResolvedValueOnce({
          items: [rawNotePlainDirect("note-plain", "act-contact-direct")],
          nextSkip: null,
          queryMode: "plain",
        });
      // listContactsForNote should NOT be called since contactId is found inline
      const listContactsForNote = vi.fn().mockResolvedValue(emptyPage());
      const client = makeClient({ listNotes, listContactsForNote });
      const { db } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-plain" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.inserted).toBe(1);
      // Relationship endpoint should not be called since contactId was found inline
      expect(listContactsForNote).not.toHaveBeenCalled();
    });
  });

  describe("plain-mode association: relationship-endpoint fallback", () => {
    it("calls listContactsForNote when no inline contact data is present", async () => {
      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [], nextSkip: 0, queryMode: "plain" })  // fallback signal
        .mockResolvedValueOnce({
          items: [rawNotePlainOrphan("note-endpoint-fallback")],
          nextSkip: null,
          queryMode: "plain",
        });
      // Relationship endpoint returns the contact
      const listContactsForNote = vi.fn()
        .mockResolvedValue({
          items: [{ id: "act-contact-from-endpoint" }],
          nextSkip: null,
          queryMode: "projected",
        });
      // Company endpoint returns nothing
      const listCompaniesForNote = vi.fn().mockResolvedValue(emptyPage());

      const client = makeClient({ listNotes, listContactsForNote, listCompaniesForNote });
      const { db } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-via-endpoint" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(listContactsForNote).toHaveBeenCalledWith(
        "note-endpoint-fallback",
        expect.objectContaining({ skip: 0, top: 1 }),
      );
      expect(result.note.inserted).toBe(1);
    });

    it("counts as unlinked when no entity found even after endpoint fallback", async () => {
      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [], nextSkip: 0, queryMode: "plain" })  // fallback signal
        .mockResolvedValueOnce({
          items: [rawNotePlainOrphan("note-truly-orphan")],
          nextSkip: null,
          queryMode: "plain",
        });
      // All relationship endpoints return empty
      const client = makeClient({ listNotes });
      const { db } = makeDb({ selectRows: [] });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.unlinked).toBe(1);
      expect(result.note.inserted).toBe(0);
      expect(result.note.skipped).toBe(0);
    });
  });

  describe("multi-page traversal", () => {
    it("fetches all pages until nextSkip is null", async () => {
      const pageA = rawNote("note-page-a");
      const pageB = rawNote("note-page-b");

      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [pageA], nextSkip: 1, queryMode: "projected" })
        .mockResolvedValueOnce({ items: [pageB], nextSkip: null, queryMode: "projected" });

      const client = makeClient({ listNotes });
      // Each note resolves to a local contact
      const { db, valuesMock } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-uuid" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      // Both pages were fetched
      expect(listNotes).toHaveBeenCalledTimes(2);
      // Both items from both pages should be inserted
      expect(result.note.inserted).toBe(2);
      expect(result.note.skipped).toBe(0);
    });

    it("terminates the stream when a page returns zero items", async () => {
      const pageA = rawNote("note-only-page");

      const listNotes = vi.fn()
        .mockResolvedValueOnce({ items: [pageA], nextSkip: 1, queryMode: "projected" })
        .mockResolvedValueOnce({ items: [], nextSkip: null, queryMode: "projected" });

      const client = makeClient({ listNotes });
      const { db } = makeDb({
        selectRows: [{ entityId: "local-contact-uuid" }],
        insertedRows: [{ id: "activity-uuid" }],
      });

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      // Two listNotes calls (first page + empty terminal page)
      expect(listNotes).toHaveBeenCalledTimes(2);
      expect(result.note.inserted).toBe(1);
    });
  });

  describe("booking association via opportunity link", () => {
    it("sets bookingId when the note has an opportunity linked to a local booking", async () => {
      const listNotes = vi.fn().mockResolvedValueOnce({
        items: [{
          id: "note-opp",
          subject: "Quoted itinerary",
          body: "Sent pricing for European rail pass",
          createDate: "2024-05-10T14:00:00Z",
          contact: { id: "act-contact-1", fullName: "Dave" },
          company: null,
          opportunity: { id: "act-opp-1", name: "European Rail 2025" },
        }],
        nextSkip: null, queryMode: "projected",
      });
      const client = makeClient({ listNotes });

      // contact resolves; company is null; opportunity→booking resolves
      const limitMock = vi.fn()
        .mockResolvedValueOnce([{ entityId: "local-contact-uuid" }])
        .mockResolvedValueOnce([{ entityId: "local-booking-uuid" }]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });

      const returningMock = vi.fn().mockResolvedValue([{ id: "activity-with-booking" }]);
      const onConflictMock = vi.fn().mockReturnValue({ returning: returningMock });
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      const db = { select: selectMock, insert: insertMock } as never;

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.inserted).toBe(1);
      const insertedValues = valuesMock.mock.calls[0]?.[0];
      expect(insertedValues?.bookingId).toBe("local-booking-uuid");
    });

    it("still inserts with contactId only when opportunity has no matching local booking", async () => {
      const listNotes = vi.fn().mockResolvedValueOnce({
        items: [{
          id: "note-no-booking",
          subject: "General enquiry", body: "Client asked about destinations",
          createDate: "2024-04-01T09:00:00Z",
          contact: { id: "act-contact-2", fullName: "Eve" },
          company: null,
          opportunity: { id: "act-opp-orphan", name: "Orphan Opp" },
        }],
        nextSkip: null, queryMode: "projected",
      });
      const client = makeClient({ listNotes });

      // contact resolves; opportunity does NOT resolve to a booking
      const limitMock = vi.fn()
        .mockResolvedValueOnce([{ entityId: "local-contact-uuid" }])
        .mockResolvedValueOnce([]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      const returningMock = vi.fn().mockResolvedValue([{ id: "activity-contact-only" }]);
      const onConflictMock = vi.fn().mockReturnValue({ returning: returningMock });
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      const db = { select: selectMock, insert: insertMock } as never;

      const service = new ActMigrationActivityImportService(client, db);
      const result = await service.importAll();

      expect(result.note.inserted).toBe(1);
      const insertedValues = valuesMock.mock.calls[0]?.[0];
      expect(insertedValues?.bookingId).toBeNull();
      expect(insertedValues?.contactId).toBe("local-contact-uuid");
    });
  });
});
