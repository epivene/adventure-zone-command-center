/**
 * Tests for the AI booking suggestion routes.
 *
 * Covers:
 * - isValidFutureDate: strict YYYY-MM-DD, future-only enforcement
 * - GET /ai-suggestions — returns pending suggestions from the session store
 * - POST /ai-suggestions/analyze — SSE endpoint: fetches history, streams AI results
 * - POST /ai-suggestions/:id/accept — creates a draft booking from a suggestion
 * - POST /ai-suggestions/:id/dismiss — marks a suggestion dismissed
 * - Auth: all routes require a valid bearer token
 */

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted state ────────────────────────────────────────────────────────────

const activityRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const insertedBooking = vi.hoisted(() => ({ value: null as unknown }));

// ─── Module mocks (hoisted before any import of the route) ───────────────────

// Stub the DB client — select().from().leftJoin()×2.where() → activityRows.value
// insert().values().returning() → [insertedBooking.value]
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: function () { return this; },
      leftJoin: function () { return this; },
      where: () => Promise.resolve(activityRows.value),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([insertedBooking.value]),
      }),
    }),
  },
}));

// Stub schema — return opaque symbols so Drizzle column refs don't throw
vi.mock("@/db/schema", () => {
  const col = () => Symbol("col");
  const table = new Proxy({}, { get: () => col() });
  return {
    activities: table,
    contacts: table,
    organizations: table,
    bookings: table,
  };
});

// Stub drizzle-orm operators — return opaque symbols
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  or: () => Symbol("or"),
  and: () => Symbol("and"),
  gte: () => Symbol("gte"),
  like: () => Symbol("like"),
}));

// Stub Anthropic AI integration — returns controlled JSON responses
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: "[]" }],
      })),
    },
  },
}));

// ─── Auth helpers ─────────────────────────────────────────────────────────────

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";

const originalSecret = process.env.SESSION_SECRET;
let authorization = "";

beforeAll(() => {
  process.env.SESSION_SECRET = "ai-suggestions-test-secret-2026";
  const issued = issueToken();
  if (!issued) throw new Error("Could not issue test token");
  authorization = `Bearer ${issued.token}`;
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

// ─── Test app setup ───────────────────────────────────────────────────────────

import { clearSuggestions, addSuggestion } from "@/features/ai-suggestions/suggestion-store";
import { isValidFutureDate } from "@/features/ai-suggestions/suggestion-analyzer";
import type { HistorySuggestion } from "@/features/ai-suggestions/suggestion-store";

let app: ReturnType<typeof express>;

beforeAll(async () => {
  const { default: router } = await import("./ai-suggestions");
  app = express();
  app.use(express.json());
  // Mount auth middleware — same as routes/index.ts
  app.use(requireOwnerMiddleware);
  app.use("/api", router);
});

beforeEach(() => {
  clearSuggestions();
  activityRows.value = [];
  insertedBooking.value = null;
});

// ─── isValidFutureDate ────────────────────────────────────────────────────────

describe("isValidFutureDate", () => {
  it("accepts a valid future date", () => {
    expect(isValidFutureDate("2099-12-31")).toBe(true);
  });

  it("rejects a past date", () => {
    expect(isValidFutureDate("2020-01-01")).toBe(false);
  });

  it("rejects today (not strictly future)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isValidFutureDate(today)).toBe(false);
  });

  it("rejects non-ISO formats", () => {
    expect(isValidFutureDate("31/12/2099")).toBe(false);
    expect(isValidFutureDate("December 31 2099")).toBe(false);
  });

  it("rejects invalid calendar dates", () => {
    expect(isValidFutureDate("2099-13-01")).toBe(false);
    expect(isValidFutureDate("2099-02-30")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidFutureDate(null)).toBe(false);
    expect(isValidFutureDate(20991231)).toBe(false);
    expect(isValidFutureDate(undefined)).toBe(false);
  });
});

// ─── Route auth ───────────────────────────────────────────────────────────────

describe("authentication", () => {
  it("GET /ai-suggestions returns 401 without token", async () => {
    const res = await request(app).get("/api/ai-suggestions");
    expect(res.status).toBe(401);
  });

  it("GET /ai-suggestions returns 200 with valid token", async () => {
    const res = await request(app)
      .get("/api/ai-suggestions")
      .set("Authorization", authorization);
    expect(res.status).toBe(200);
  });
});

// ─── GET /ai-suggestions ──────────────────────────────────────────────────────

describe("GET /ai-suggestions", () => {
  it("returns an empty array before any analysis", async () => {
    const res = await request(app)
      .get("/api/ai-suggestions")
      .set("Authorization", authorization);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns pending suggestions after they are added to the store", async () => {
    const suggestion: HistorySuggestion = {
      id: "test-id-1",
      suggestedDate: "2099-08-01",
      suggestedDateEnd: null,
      clientName: "Jane Smith",
      tripDescription: "Annual river rafting trip",
      location: "Aspen, CO",
      confidence: "high",
      sourceSnippet: "See you next August!",
      actRecordId: "act_activity:abc",
      status: "pending",
      bookingId: null,
    };
    addSuggestion(suggestion);

    const res = await request(app)
      .get("/api/ai-suggestions")
      .set("Authorization", authorization);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("test-id-1");
    expect(res.body[0].clientName).toBe("Jane Smith");
  });
});

// ─── POST /ai-suggestions/analyze (SSE) ──────────────────────────────────────

describe("POST /ai-suggestions/analyze", () => {
  it("returns SSE Content-Type and a done event when no records exist", async () => {
    activityRows.value = [];

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    // Parse SSE lines
    const events = res.text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);

    const fetchedEvent = events.find((e) => e.type === "fetched");
    expect(fetchedEvent).toBeDefined();
    expect(fetchedEvent!.count).toBe(0);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.totalRecords).toBe(0);
    expect(doneEvent!.totalSuggestions).toBe(0);
  });

  it("streams a suggestion event when AI returns one", async () => {
    // One activity record in the DB
    activityRows.value = [
      {
        id: "act-row-1",
        body: "Great trip! Same time next year in July 2099.",
        subject: "Follow-up with Smith Family",
        kind: "act_history",
        timelineSortAt: new Date("2026-01-15"),
        actRecordId: "act_activity:xyz",
        contactFirstName: "John",
        contactLastName: "Smith",
        organizationName: null,
      },
    ];

    // AI returns one future suggestion
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              clientName: "Smith Family",
              tripDescription: "Annual summer river rafting",
              suggestedDate: "2099-07-01",
              suggestedDateEnd: "2099-07-07",
              location: "Aspen, CO",
              confidence: "high",
              sourceSnippet: "Same time next year in July",
              actRecordId: "act_activity:xyz",
            },
          ]),
        },
      ],
    } as any);

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);

    const events = res.text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);

    const suggestionEvent = events.find((e) => e.type === "suggestion");
    expect(suggestionEvent).toBeDefined();
    const sugg = suggestionEvent!.suggestion as Record<string, unknown>;
    expect(sugg.clientName).toBe("Smith Family");
    expect(sugg.confidence).toBe("high");
    expect(sugg.suggestedDate).toBe("2099-07-01");

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent!.totalSuggestions).toBe(1);
  });

  it("silently drops past dates returned by the AI", async () => {
    activityRows.value = [
      {
        id: "act-row-2",
        body: "Booked for last year.",
        subject: "Old booking note",
        kind: "act_history",
        timelineSortAt: new Date("2025-06-01"),
        actRecordId: "act_activity:old",
        contactFirstName: null,
        contactLastName: null,
        organizationName: "Acme Corp",
      },
    ];

    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              clientName: "Acme Corp",
              tripDescription: "Past trip that should be rejected",
              suggestedDate: "2020-01-01", // past date
              suggestedDateEnd: "2020-01-07",
              location: null,
              confidence: "low",
              sourceSnippet: "Booked for last year",
              actRecordId: "act_activity:old",
            },
          ]),
        },
      ],
    } as any);

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);

    const events = res.text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);

    // Suggestion is still emitted (AI returned it) but dates are null
    const suggestionEvent = events.find((e) => e.type === "suggestion");
    expect(suggestionEvent).toBeDefined();
    const sugg = suggestionEvent!.suggestion as Record<string, unknown>;
    expect(sugg.suggestedDate).toBeNull();
    expect(sugg.suggestedDateEnd).toBeNull();
  });
});

// ─── POST /ai-suggestions/:id/dismiss ────────────────────────────────────────

describe("POST /ai-suggestions/:id/dismiss", () => {
  it("returns 404 for an unknown suggestion id", async () => {
    const res = await request(app)
      .post("/api/ai-suggestions/nonexistent-id/dismiss")
      .set("Authorization", authorization);
    expect(res.status).toBe(404);
  });

  it("marks a pending suggestion dismissed", async () => {
    const suggestion: HistorySuggestion = {
      id: "dismiss-test",
      suggestedDate: null,
      suggestedDateEnd: null,
      clientName: "Test Client",
      tripDescription: "Test trip",
      location: null,
      confidence: "low",
      sourceSnippet: "snippet",
      actRecordId: null,
      status: "pending",
      bookingId: null,
    };
    addSuggestion(suggestion);

    const res = await request(app)
      .post("/api/ai-suggestions/dismiss-test/dismiss")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe("dismissed");
  });

  it("returns 409 for an already-dismissed suggestion", async () => {
    addSuggestion({
      id: "already-dismissed",
      suggestedDate: null,
      suggestedDateEnd: null,
      clientName: null,
      tripDescription: "Already gone",
      location: null,
      confidence: "low",
      sourceSnippet: "s",
      actRecordId: null,
      status: "dismissed",
      bookingId: null,
    });

    const res = await request(app)
      .post("/api/ai-suggestions/already-dismissed/dismiss")
      .set("Authorization", authorization);
    expect(res.status).toBe(409);
  });
});

// ─── POST /ai-suggestions/:id/accept ─────────────────────────────────────────

describe("POST /ai-suggestions/:id/accept", () => {
  it("returns 404 for an unknown suggestion id", async () => {
    const res = await request(app)
      .post("/api/ai-suggestions/no-such-id/accept")
      .set("Authorization", authorization);
    expect(res.status).toBe(404);
  });

  it("creates a booking and marks suggestion accepted", async () => {
    insertedBooking.value = { id: "new-booking-uuid", name: "Smith Family — River rafting" };

    addSuggestion({
      id: "accept-test",
      suggestedDate: "2099-07-01",
      suggestedDateEnd: "2099-07-07",
      clientName: "Smith Family",
      tripDescription: "River rafting",
      location: "Aspen, CO",
      confidence: "high",
      sourceSnippet: "Same time next year",
      actRecordId: "act_activity:abc",
      status: "pending",
      bookingId: null,
    });

    const res = await request(app)
      .post("/api/ai-suggestions/accept-test/accept")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe("accepted");
    expect(res.body.suggestion.bookingId).toBe("new-booking-uuid");
    expect(res.body.booking.id).toBe("new-booking-uuid");
  });

  it("returns 409 for an already-accepted suggestion", async () => {
    addSuggestion({
      id: "already-accepted",
      suggestedDate: null,
      suggestedDateEnd: null,
      clientName: null,
      tripDescription: "Already booked",
      location: null,
      confidence: "medium",
      sourceSnippet: "s",
      actRecordId: null,
      status: "accepted",
      bookingId: "some-booking-id",
    });

    const res = await request(app)
      .post("/api/ai-suggestions/already-accepted/accept")
      .set("Authorization", authorization);
    expect(res.status).toBe(409);
  });
});
