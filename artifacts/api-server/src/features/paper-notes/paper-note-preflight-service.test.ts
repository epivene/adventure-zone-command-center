import { describe, expect, it, vi } from "vitest";

import { PaperNotePreflightService } from "./paper-note-preflight-service";

function approvedEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    state: "approved",
    pageId: "20000000-0000-4000-8000-000000000001",
    review: {
      event: { name: "County Fair", city: "Minot", region: "ND", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
      activity: { occurredOn: null, method: "call", outcome: "", summary: "" },
      contacts: [],
      organizationPhones: [],
      oldReminder: "Call Monday",
      starredOnPaper: false,
      generalNotes: [],
      destination: { mode: "new_profile", eventFamilyId: null },
      conflicts: {},
      currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
    },
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const repository = {
    loadBatch: vi.fn(async () => ({
      id: "10000000-0000-4000-8000-000000000001",
      status: "review",
      pages: [{
        id: "20000000-0000-4000-8000-000000000001",
        status: "extracted",
        originalObjectKey: "paper-notes/source",
      }],
      entries: [approvedEntry()],
      ...overrides,
    })),
    targetExists: vi.fn(async () => true),
  };
  const storage = { exists: vi.fn(async () => true) };
  return { repository, storage, service: new PaperNotePreflightService(repository as any, storage as any) };
}

describe("PaperNotePreflightService", () => {
  it("allows a completely reviewed batch and previews writes without mutating CRM", async () => {
    const { service, repository } = harness();
    const result = await service.preflight({
      actorId: "owner",
      batchId: "10000000-0000-4000-8000-000000000001",
      now: new Date("2026-08-20T18:00:00Z"),
    });
    expect(result.ready).toBe(true);
    expect(result.approvedCount).toBe(1);
    expect(result.preview).toMatchObject({
      profilesCreated: 1,
      historicalNotesCreated: 1,
      followUpsCreated: 0,
    });
    expect(repository.targetExists).not.toHaveBeenCalled();
  });

  it("blocks when an entry is still unresolved or zero entries are approved", async () => {
    const { service } = harness({ entries: [{ ...approvedEntry(), state: "ready" }] });
    const result = await service.preflight({ actorId: "owner", batchId: "10000000-0000-4000-8000-000000000001", now: new Date() });
    expect(result.ready).toBe(false);
    expect(result.blocking.map((item) => item.code)).toEqual(expect.arrayContaining([
      "ENTRY_NOT_FINAL",
      "NO_APPROVED_ENTRIES",
    ]));
  });

  it("blocks a retryable page or missing source object", async () => {
    const h = harness({ pages: [{ id: "20000000-0000-4000-8000-000000000001", status: "needs_retry", originalObjectKey: "paper-notes/source" }] });
    h.storage.exists.mockResolvedValue(false);
    const result = await h.service.preflight({ actorId: "owner", batchId: "10000000-0000-4000-8000-000000000001", now: new Date() });
    expect(result.blocking.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PAGE_NOT_RESOLVED",
      "SOURCE_MISSING",
    ]));
  });

  it("blocks an existing-profile destination when the target disappeared", async () => {
    const entry = approvedEntry({
      review: {
        ...approvedEntry().review,
        destination: {
          mode: "existing_profile",
          organizationId: "40000000-0000-4000-8000-000000000001",
          organizationLocationId: null,
        },
      },
    });
    const h = harness({ entries: [entry] });
    h.repository.targetExists.mockResolvedValue(false);
    const result = await h.service.preflight({ actorId: "owner", batchId: "10000000-0000-4000-8000-000000000001", now: new Date() });
    expect(result.ready).toBe(false);
    expect(result.blocking).toContainEqual(expect.objectContaining({
      entryId: entry.id,
      code: "TARGET_MISSING",
    }));
  });
});
