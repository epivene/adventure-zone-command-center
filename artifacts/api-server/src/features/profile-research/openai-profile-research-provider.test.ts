import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiProfileResearchProvider } from "./openai-profile-research-provider";
import type { ProfileResearchContext } from "./profile-research-types";

const context: ProfileResearchContext = {
  profileId: "10000000-0000-4000-8000-000000000001",
  profileName: "River Days",
  mode: "quick",
  knownFacts: [{ key: "location", value: "Fargo, ND", source: "crm" }],
  searchClues: ["River Days Fargo ND"],
  gaps: [{ field: "website", label: "Website", targetKind: "organization", targetId: "10000000-0000-4000-8000-000000000001" }],
};

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe("OpenAiProfileResearchProvider", () => {
  it("keeps only candidates backed by URLs actually cited in the response", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            identity: { confidence: "high", rationale: "Official event source matched." },
            candidates: [
              { targetKind: "organization", targetId: null, field: "website", value: "https://riverdays.example", rationale: "Official site", sourceUrls: ["https://riverdays.example"] },
              { targetKind: "organization", targetId: null, field: "phone", value: "701-555-1212", rationale: "Uncited number", sourceUrls: ["https://uncited.example"] },
            ],
            deepSummary: null,
          }),
          annotations: [{ type: "url_citation", url: "https://riverdays.example", title: "River Days" }],
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiProfileResearchProvider().research({ context, mode: "quick" });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(expect.objectContaining({ field: "website", sourceUrls: ["https://riverdays.example"] }));
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.url).toBe("https://riverdays.example");
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([expect.objectContaining({ type: "web_search" })]);
  });

  it("fails clearly when no public research provider key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(new OpenAiProfileResearchProvider().research({ context, mode: "quick" }))
      .rejects.toThrow("OPENAI_API_KEY is required");
  });
});
