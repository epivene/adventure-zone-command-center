import { describe, expect, it, vi } from "vitest";

import { FollowUpService } from "./follow-up-service";
import type { FollowUpRecord } from "./follow-up-types";

const validFollowUpId = "40000000-0000-4000-8000-000000000001";
const validDueAt = new Date("2026-09-01T15:00:00.000Z");

function record(overrides: Partial<FollowUpRecord> = {}): FollowUpRecord {
  return {
    id: validFollowUpId,
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: null,
    bookingId: null,
    kind: "call",
    dueAt: validDueAt,
    completedAt: null,
    outcome: null,
    ...overrides,
  };
}

describe("FollowUpService editing", () => {
  it("rejects a blank kind before reaching the repository", async () => {
    const repository = { edit: vi.fn() };
    const service = new FollowUpService(repository as never);

    const result = await service.edit({
      followUpId: validFollowUpId,
      kind: "   ",
      dueAt: validDueAt,
      completed: false,
      outcome: null,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_FOLLOW_UP_INPUT" }),
    });
    expect(repository.edit).not.toHaveBeenCalled();
  });

  it("rejects invalid due dates before reaching the repository", async () => {
    const repository = { edit: vi.fn() };
    const service = new FollowUpService(repository as never);

    const result = await service.edit({
      followUpId: validFollowUpId,
      kind: "call",
      dueAt: new Date(Number.NaN),
      completed: false,
      outcome: null,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_FOLLOW_UP_INPUT" }),
    });
    expect(repository.edit).not.toHaveBeenCalled();
  });

  it("rejects a completed follow-up without an outcome before reaching the repository", async () => {
    const repository = { edit: vi.fn() };
    const service = new FollowUpService(repository as never);

    const result = await service.edit({
      followUpId: validFollowUpId,
      kind: "call",
      dueAt: validDueAt,
      completed: true,
      outcome: "   ",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_FOLLOW_UP_INPUT" }),
    });
    expect(repository.edit).not.toHaveBeenCalled();
  });

  it("normalizes incomplete follow-up outcome to null", async () => {
    const repository = {
      edit: vi.fn().mockResolvedValue({ ok: true, value: record() }),
    };
    const service = new FollowUpService(repository as never);

    const result = await service.edit({
      followUpId: validFollowUpId,
      kind: "call",
      dueAt: validDueAt,
      completed: false,
      outcome: "left voicemail",
    });

    expect(result.ok).toBe(true);
    expect(repository.edit).toHaveBeenCalledWith({
      followUpId: validFollowUpId,
      kind: "call",
      dueAt: validDueAt,
      completed: false,
      outcome: null,
    });
  });
});
