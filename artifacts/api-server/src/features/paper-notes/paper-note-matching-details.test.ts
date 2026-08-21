import { describe, expect, it, vi } from "vitest";

import { PostgresPaperNoteMatchRepository } from "./paper-note-matching-service";

describe("PostgresPaperNoteMatchRepository.findDetails", () => {
  it("includes a legacy contact linked directly by contacts.organization_id", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        organizationId: "10000000-0000-4000-8000-000000000001",
        id: "50000000-0000-4000-8000-000000000001",
        name: "Deborah Lay",
        role: null,
        email: null,
      }] })
      .mockResolvedValueOnce({ rows: [{
        contactId: "50000000-0000-4000-8000-000000000001",
        id: "60000000-0000-4000-8000-000000000001",
        number: "435-890-6349",
        extension: null,
        type: "mobile",
        label: null,
        instructions: null,
        status: "active",
        primary: true,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const repository = new PostgresPaperNoteMatchRepository({ execute } as never);
    const details = await repository.findDetails(["10000000-0000-4000-8000-000000000001"]);

    expect(details.get("10000000-0000-4000-8000-000000000001")?.contacts).toContainEqual(
      expect.objectContaining({
        id: "50000000-0000-4000-8000-000000000001",
        name: "Deborah Lay",
        phones: [expect.objectContaining({ number: "435-890-6349" })],
      }),
    );
  });
});
