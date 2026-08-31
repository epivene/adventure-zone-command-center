import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from "node:fs/promises";
import { importApprovedProfilesAtStartup } from "./startup-import";

const FIRST_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function payload(name: string, city: string, region: string, note: string) {
  return {
    importRevision: 1,
    event: { id: null, name, city, region },
    profile: { placeType: "fair" },
    contacts: [],
    booking: { enabled: false },
    notes: [{ subject: "Batch research", body: note }],
    followUps: [],
  };
}

describe("approved profile startup batch import", () => {
  const originalToken = process.env["ASSISTANT_IMPORT_TOKEN"];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env["ASSISTANT_IMPORT_TOKEN"] = "test-token";
    vi.mocked(readdir).mockResolvedValue(["batch.json"] as never);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([
      payload("First Fair", "First City", "CO", "First reviewed profile."),
      payload("Second Fair", "Second City", "WY", "Second reviewed profile."),
    ]) as never);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["ASSISTANT_IMPORT_TOKEN"];
    else process.env["ASSISTANT_IMPORT_TOKEN"] = originalToken;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("imports every reviewed profile contained in one JSON batch file", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, profileId: FIRST_PROFILE_ID }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true, created: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true, profileId: SECOND_PROFILE_ID }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true, created: true }, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await importApprovedProfilesAtStartup(5000);

    expect(result).toEqual({ imported: 2, skipped: 0, files: ["batch.json"] });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstImport = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const secondImport = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
    expect(firstImport.event.name).toBe("First Fair");
    expect(secondImport.event.name).toBe("Second Fair");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:5000/api/assistant-import/profile-notes",
      expect.objectContaining({
        body: JSON.stringify({
          organizationId: FIRST_PROFILE_ID,
          subject: "Batch research",
          body: "First reviewed profile.",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:5000/api/assistant-import/profile-notes",
      expect.objectContaining({
        body: JSON.stringify({
          organizationId: SECOND_PROFILE_ID,
          subject: "Batch research",
          body: "Second reviewed profile.",
        }),
      }),
    );
  });
});
