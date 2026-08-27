import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from "node:fs/promises";
import { importApprovedProfilesAtStartup } from "./startup-import";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function basePayload() {
  return {
    importRevision: 2,
    event: {
      id: null,
      name: "Sample Fair",
      city: "Sampleton",
      region: "WY",
    },
    profile: {
      placeType: "fair",
      description: "Sample profile",
      phone: "",
      website: "",
      address1: "",
      address2: "",
      postalCode: "",
    },
    contacts: [],
    booking: {
      enabled: false,
      name: "",
      status: "new_lead",
      startsAt: "",
      endsAt: "",
      nextActionKind: "call",
      nextActionDueAt: "",
      travelLegId: null,
    },
    familyId: null,
    parentOrganizationId: null,
  };
}

describe("approved profile startup import", () => {
  const originalToken = process.env["ASSISTANT_IMPORT_TOKEN"];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env["ASSISTANT_IMPORT_TOKEN"] = "test-token";
    vi.mocked(readdir).mockResolvedValue(["sample.json"] as never);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      ...basePayload(),
      notes: [
        {
          subject: "Historical call - Kristy",
          body: "Kristy called during 2026 outreach. Left message.",
        },
      ],
      followUps: [
        {
          label: "2027 booking follow-up",
          reason: "Check 2027 dates and begin renewal outreach.",
          dueAt: "2026-11-02T15:00:00.000Z",
        },
      ],
    }) as never);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["ASSISTANT_IMPORT_TOKEN"];
    else process.env["ASSISTANT_IMPORT_TOKEN"] = originalToken;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("applies approved notes and follow-ups after the profile import", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, profileId: PROFILE_ID }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true, created: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true, created: true }, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await importApprovedProfilesAtStartup(5000);

    expect(result.imported).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:5000/api/assistant-import/profile-notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        body: JSON.stringify({
          organizationId: PROFILE_ID,
          subject: "Historical call - Kristy",
          body: "Kristy called during 2026 outreach. Left message.",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:5000/api/assistant-import/today-followups",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        body: JSON.stringify({
          organizationId: PROFILE_ID,
          label: "2027 booking follow-up",
          reason: "Check 2027 dates and begin renewal outreach.",
          dueAt: "2026-11-02T15:00:00.000Z",
        }),
      }),
    );
  });

  it("can safely target an existing profile before applying a reviewed update", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      ...basePayload(),
      matchExisting: true,
      event: {
        id: null,
        name: "MeekerPalooza",
        city: "Meeker",
        region: "CO",
      },
      profile: {},
      notes: [
        {
          subject: "Historical call - Kristy",
          body: "Kristy called during 2026 outreach. No answer.",
        },
      ],
    }) as never);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        results: [
          {
            id: PROFILE_ID,
            kind: "organization",
            label: "MeekerPalooza Series & Market",
            city: "Meeker",
            region: "CO",
            matchedOn: ["name"],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, profileId: PROFILE_ID }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true, created: true }, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    await importApprovedProfilesAtStartup(5000);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:5000/api/assistant-import/profile-search?q=MeekerPalooza&limit=20",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall?.[0]).toBe("http://127.0.0.1:5000/api/assistant-import/event-profiles");
    const request = secondCall?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.event.id).toBe(PROFILE_ID);
  });

  it("skips an ambiguous existing-profile match without blocking the rest of the startup import", async () => {
    vi.mocked(readdir).mockResolvedValue(["ambiguous.json", "safe.json"] as never);
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify({
        ...basePayload(),
        matchExisting: true,
        event: { id: null, name: "County Fair", city: "Sampleton", region: "WY" },
        profile: {},
        notes: [{ subject: "Historical call - Kristy", body: "Ambiguous source note." }],
      }) as never)
      .mockResolvedValueOnce(JSON.stringify({
        ...basePayload(),
        notes: [{ subject: "Historical call - Kristy", body: "Safe source note." }],
        followUps: [],
      }) as never);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        results: [
          { id: PROFILE_ID, kind: "organization", label: "County Fair East", city: "Sampleton", region: "WY" },
          { id: "22222222-2222-4222-8222-222222222222", kind: "organization", label: "County Fair West", city: "Sampleton", region: "WY" },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, profileId: PROFILE_ID }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true, created: true }, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await importApprovedProfilesAtStartup(5000);

    expect(result).toMatchObject({ imported: 1, skipped: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
