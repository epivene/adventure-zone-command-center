import { describe, expect, it, vi } from "vitest";

import { OpenAiLeadScoutProvider } from "./openai-lead-scout-provider";
import type { LeadDiscoveryCriteria, LeadScoutSourceInput } from "./lead-scout-types";

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "Find events between Montana and Utah in September 2026",
  dateFrom: "2026-09-01", dateThrough: "2026-09-30", month: 9, year: 2026,
  regions: ["MT", "ID", "WY", "UT"], cities: [], geoMode: "corridor",
  routeId: null, legId: null, eventKeywords: ["festival"], fitIntent: "either",
};

function response(output: unknown, citations: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output_text: JSON.stringify(output),
      output: [{ content: [{ text: JSON.stringify(output), annotations: citations.map((url) => ({ type: "url_citation", url, title: url })) }] }],
    }),
    text: async () => "",
  } as Response;
}

type FetchInput = string | URL | Request;
type MockFetch = (input: FetchInput, init?: RequestInit) => Promise<Response>;

describe("OpenAiLeadScoutProvider", () => {
  it("keeps only cited safe bounded public sources", async () => {
    const fetchFn = vi.fn<MockFetch>(async (_input, _init) => response({
      sources: [
        { url: "https://visitidaho.org/events", title: "Idaho events", publisher: "Visit Idaho", category: "tourism_chamber", excerpt: "x".repeat(1800) },
        { url: "https://uncited.example/events", title: "Uncited", publisher: null, category: "other", excerpt: "no" },
        { url: "javascript:alert(1)", title: "Bad", publisher: null, category: "other", excerpt: "bad" },
      ],
    }, ["https://visitidaho.org/events"]));
    const provider = new OpenAiLeadScoutProvider(fetchFn as typeof fetch, "test-key");

    const sources = await provider.discoverSources(criteria);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ url: "https://visitidaho.org/events", title: "Idaho events", category: "tourism_chamber" });
    expect((sources[0]?.excerpt ?? "").length).toBeLessThanOrEqual(1200);
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([{ type: "web_search", search_context_size: "high" }]);
    expect(body.input).toMatch(/untrusted data/i);
    expect(body.input).toMatch(/2026-09-01.*2026-09-30/s);
    expect(body.input).toMatch(/MT.*ID.*WY.*UT/s);
    expect(body.input).not.toMatch(/private CRM notes/i);
  });

  it("keeps only cited candidates in the requested region and date window", async () => {
    const source: LeadScoutSourceInput = {
      url: "https://visitidaho.org/events", title: "Idaho events", publisher: "Visit Idaho",
      category: "tourism_chamber", retrievedAt: "2026-08-19T18:00:00.000Z", excerpt: "events",
    };
    const fetchFn = vi.fn<MockFetch>(async (_input, _init) => response({
      candidates: [
        { name: "Silver Valley Days", city: "Kellogg", region: "ID", startsAt: "2026-09-11", endsAt: "2026-09-13", venue: "Downtown", url: "https://visitidaho.org/silver-valley", eventType: "community festival", rationale: "Family event" },
        { name: "Colorado Event", city: "Denver", region: "CO", startsAt: "2026-09-12", endsAt: null, venue: null, url: "https://example.org/co", eventType: "festival", rationale: "Outside corridor" },
        { name: "October Event", city: "Boise", region: "ID", startsAt: "2026-10-02", endsAt: null, venue: null, url: "https://example.org/oct", eventType: "festival", rationale: "Outside date" },
        { name: "Uncited Event", city: "Boise", region: "ID", startsAt: "2026-09-20", endsAt: null, venue: null, url: "https://example.org/uncited", eventType: "festival", rationale: "No citation" },
      ],
    }, ["https://visitidaho.org/silver-valley", "https://example.org/co", "https://example.org/oct"]));
    const provider = new OpenAiLeadScoutProvider(fetchFn as typeof fetch, "test-key");

    const candidates = await provider.discoverCandidates({ criteria, sources: [source] });

    expect(candidates).toEqual([expect.objectContaining({
      name: "Silver Valley Days", city: "Kellogg", region: "ID", startsAt: "2026-09-11",
      website: "https://visitidaho.org/silver-valley",
    })]);
  });

  it("returns an empty bounded result for malformed model output and caps candidate count", async () => {
    const malformed = vi.fn<MockFetch>(async (_input, _init) => ({
      ok: true, status: 200,
      json: async () => ({ output_text: "not json", output: [] }),
      text: async () => "",
    } as Response));
    const badProvider = new OpenAiLeadScoutProvider(malformed as typeof fetch, "test-key");
    expect(await badProvider.discoverSources(criteria)).toEqual([]);

    const many = Array.from({ length: 55 }, (_, index) => ({
      name: `Event ${index}`, city: "Boise", region: "ID", startsAt: "2026-09-15", endsAt: null,
      venue: null, url: `https://example.org/event-${index}`, eventType: "festival", rationale: "fit",
    }));
    const citations = many.map((item) => item.url);
    const fetchFn = vi.fn<MockFetch>(async (_input, _init) => response({ candidates: many }, citations));
    const provider = new OpenAiLeadScoutProvider(fetchFn as typeof fetch, "test-key");
    const candidates = await provider.discoverCandidates({ criteria, sources: [] });
    expect(candidates).toHaveLength(40);
  });

  it("passes cancellation through to the web request", async () => {
    const fetchFn = vi.fn<MockFetch>(async (_input, _init) => response({ sources: [] }, []));
    const provider = new OpenAiLeadScoutProvider(fetchFn as typeof fetch, "test-key");
    const controller = new AbortController();
    await provider.discoverSources(criteria, controller.signal);
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
