import { describe, expect, it, vi } from "vitest";

import { OpenAiLeadScoutProvider } from "./openai-lead-scout-provider";
import type { LeadDiscoveryCriteria, LeadScoutSourceInput } from "./lead-scout-types";

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "Find events between Montana and Utah in September 2026",
  dateFrom: "2026-09-01",
  dateThrough: "2026-09-30",
  month: 9,
  year: 2026,
  regions: ["MT", "ID", "WY", "UT"],
  cities: [],
  geoMode: "corridor",
  routeId: null,
  legId: null,
  eventKeywords: [],
  fitIntent: "either",
};

const source: LeadScoutSourceInput = {
  url: "https://example.org/events",
  title: "Regional events",
  publisher: "Example tourism",
  category: "tourism_chamber",
  retrievedAt: "2026-08-19T20:00:00.000Z",
  excerpt: "Regional event calendar",
};

describe("Lead Scout discovery prompt priorities", () => {
  it("asks web discovery to prioritize large multi-day child/family events and deprioritize adult/small special-interest events", async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ candidates: [] }), output: [] }),
      text: async () => "",
    } as Response));
    const provider = new OpenAiLeadScoutProvider(fetchFn as typeof fetch, "test-key");

    await provider.discoverCandidates({ criteria, sources: [source] });

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body.input).toMatch(/child|children|family-friendly/i);
    expect(body.input).toMatch(/multi-day/i);
    expect(body.input).toMatch(/attendance|turnout|large public/i);
    expect(body.input).toMatch(/deprioritize|omit/i);
    expect(body.input).toMatch(/adult|nightlife|paranormal|special-interest/i);
  });
});
