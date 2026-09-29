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
            eventDateCandidates: [{
              startsOn: "2027-09-05",
              endsOn: "2027-09-07",
              evidenceKind: "published_exact",
              recurrenceRule: null,
              rationale: "The official site publishes the dates.",
              sourceUrl: "https://riverdays.example",
              confidence: 0.98,
            }, {
              startsOn: null,
              endsOn: null,
              evidenceKind: "recognized_recurrence",
              recurrenceRule: { kind: "ordinal_weekday", month: 9, ordinal: 1, weekday: 6, durationDays: 3 },
              rationale: "The event recurs on the first Saturday.",
              sourceUrl: "https://riverdays.example",
              confidence: 0.8,
            }, {
              startsOn: "2027-09-05",
              endsOn: null,
              evidenceKind: "ambiguous",
              recurrenceRule: null,
              rationale: "A second source conflicts.",
              sourceUrl: "https://riverdays.example",
              confidence: 0.45,
            }],
            findings: [],
            relatedEvents: [],
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
    expect(result.eventDateCandidates).toEqual([
      expect.objectContaining({
        startsOn: "2027-09-05",
        endsOn: "2027-09-07",
        evidenceKind: "published_exact",
        confidence: 0.98,
        source: expect.objectContaining({ url: "https://riverdays.example" }),
      }),
      expect.objectContaining({
        evidenceKind: "recognized_recurrence",
        recurrenceRule: expect.objectContaining({ kind: "ordinal_weekday" }),
      }),
      expect.objectContaining({ evidenceKind: "ambiguous", confidence: 0.45 }),
    ]);
    expect(result.relatedEvents).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["web_search_call.action.sources"]);
    expect(body.tools).toEqual([expect.objectContaining({ type: "web_search" })]);
  });

  it("uses consulted web-search sources when JSON output has no inline citations", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const officialUrl = "https://riverdays.example/2027-dates";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: officialUrl }] } },
        { type: "message", content: [{
          type: "output_text",
          text: JSON.stringify({
            identity: { confidence: "high", rationale: "Official organizer matched." },
            candidates: [],
            eventDateCandidates: [
              { startsOn: "2027-07-14", endsOn: "2027-07-17", evidenceKind: "published_exact", recurrenceRule: null, rationale: "Published by organizer.", sourceUrl: officialUrl, confidence: 0.98 },
              { startsOn: "2027-08-01", endsOn: null, evidenceKind: "published_exact", recurrenceRule: null, rationale: "Unsupported.", sourceUrl: "https://uncited.example", confidence: 0.9 },
            ],
            findings: [], relatedEvents: [], deepSummary: null,
          }),
          annotations: [],
        }] },
      ],
    }), { status: 200 })));

    const result = await new OpenAiProfileResearchProvider().research({
      context: { ...context, gaps: [{ field: "next_event_dates", label: "Next event dates", targetKind: "event_date_fact", targetId: null }] },
      mode: "quick",
    });

    expect(result.eventDateCandidates).toEqual([expect.objectContaining({ startsOn: "2027-07-14", source: expect.objectContaining({ url: officialUrl }) })]);
    expect(result.sources).toEqual([expect.objectContaining({ url: officialUrl })]);
  });

  it("preserves cited key findings and related event opportunities during deep research", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const calendarUrl = "https://gobreck.example/events";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{
        type: "output_text",
        text: JSON.stringify({
          identity: { confidence: "high", rationale: "Official tourism source matched." },
          candidates: [],
          findings: [{ label: "2026 dates", value: "June 11–13, 2026", rationale: "Official calendar", sourceUrls: [calendarUrl] }],
          relatedEvents: [
            { name: "Bluegrass + Beer Festival", city: "Breckenridge", region: "CO", startsAt: "2026-09-11", endsAt: "2026-09-13", venue: "Main Street Station", url: calendarUrl, rationale: "Listed on the same official seasonal calendar." },
            { name: "Uncited Mystery Fest", city: "Breckenridge", region: "CO", url: "https://uncited.example", rationale: "Not cited" },
          ],
          deepSummary: "Useful broader event calendar discovered.",
        }),
        annotations: [{ type: "url_citation", url: calendarUrl, title: "Breckenridge Events" }],
      }] }],
    }), { status: 200 })));

    const result = await new OpenAiProfileResearchProvider().research({ context: { ...context, mode: "deep" }, mode: "deep" });

    expect(result.findings).toEqual([expect.objectContaining({ label: "2026 dates", value: "June 11–13, 2026" })]);
    expect(result.relatedEvents).toEqual([expect.objectContaining({ name: "Bluegrass + Beer Festival", url: calendarUrl })]);
    expect(result.deepSummary).toContain("broader event calendar");
  });

  it("requests a structured recurrence when the next event date is missing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{
        type: "output_text",
        text: JSON.stringify({
          identity: { confidence: "high", rationale: "Official event source matched." },
          candidates: [],
          eventDateCandidates: [],
          findings: [],
          relatedEvents: [],
          deepSummary: null,
        }),
        annotations: [],
      }] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiProfileResearchProvider().research({
      context: {
        ...context,
        knownFacts: [
          ...context.knownFacts,
          { key: "booking:booking-1:date", value: "2026-09-18", source: "crm" },
        ],
        gaps: [{
          field: "next_event_dates",
          label: "Next event dates",
          targetKind: "event_date_fact",
          targetId: null,
        }],
      },
      mode: "quick",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const prompt = JSON.parse(String(request.body)).input as string;
    expect(prompt).toContain("If no future exact date is published, check recent prior years");
    expect(prompt).toContain('{"kind":"ordinal_weekday","month":9,"ordinal":3,"weekday":5,"durationDays":2}');
    expect(prompt).toContain("weekday uses 0=Sunday through 6=Saturday");
  });

  it("fails clearly when no public research provider key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(new OpenAiProfileResearchProvider().research({ context, mode: "quick" }))
      .rejects.toThrow("OPENAI_API_KEY is required");
  });
});
