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
// Captures values passed to bookings / booking_contacts inserts (accept route)
const bookingInsertValues = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const bookingContactValues = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
// In-memory backing table for the DB-persisted suggestion store
const suggestionRows = vi.hoisted(() => ({
  value: [] as Array<Record<string, unknown>>,
}));

// ─── Module mocks (hoisted before any import of the route) ───────────────────

// Stub the DB client.
// - Activities query (analyze route): select({...}).from().leftJoin()×2.where()
//   → activityRows.value
// - Bookings insert (accept route): insert().values().returning()
//   → [insertedBooking.value]
// - ai_booking_suggestions table (suggestion store): select/insert/update/delete
//   operate on suggestionRows.value, emulating the dedupe_key unique index via
//   onConflictDoNothing.
vi.mock("@/db/client", () => {
  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table.__name === "aiBookingSuggestions") {
          return {
            orderBy: () => Promise.resolve([...suggestionRows.value]),
            where: (cond: { __eq?: unknown }) =>
              Promise.resolve(
                suggestionRows.value.filter((r) => r.id === cond.__eq),
              ),
          };
        }
        return {
          leftJoin: function () { return this; },
          where: () => Promise.resolve(activityRows.value),
        };
      },
    }),
    insert: (table: { __name?: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table.__name === "aiBookingSuggestions") {
          return {
            onConflictDoNothing: () => ({
              returning: () => {
                if (
                  suggestionRows.value.some(
                    (r) => r.dedupeKey === v.dedupeKey,
                  )
                ) {
                  return Promise.resolve([]);
                }
                suggestionRows.value.push({ ...v });
                return Promise.resolve([{ id: v.id }]);
              },
            }),
          };
        }
        if (table.__name === "bookingContacts") {
          bookingContactValues.value = { ...v };
          return Promise.resolve();
        }
        bookingInsertValues.value = { ...v };
        return {
          returning: () => Promise.resolve([insertedBooking.value]),
        };
      },
    }),
    update: (table: { __name?: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: { __eq?: unknown }) => ({
          returning: () => {
            if (table.__name === "bookings") {
              // Accept route: primary-contact linking updates the booking row.
              insertedBooking.value = {
                ...(insertedBooking.value as Record<string, unknown>),
                ...patch,
              };
              return Promise.resolve([insertedBooking.value]);
            }
            const idx = suggestionRows.value.findIndex(
              (r) => r.id === cond.__eq,
            );
            if (idx === -1) return Promise.resolve([]);
            suggestionRows.value[idx] = {
              ...suggestionRows.value[idx],
              ...patch,
            };
            return Promise.resolve([suggestionRows.value[idx]]);
          },
        }),
      }),
    }),
    delete: () => {
      suggestionRows.value = [];
      return Promise.resolve();
    },
  };
  // Transaction just runs the callback against the same mock db.
  db.transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});

// Stub schema — opaque column symbols; each table carries a __name marker so
// the db mock can route ai_booking_suggestions operations to suggestionRows.
vi.mock("@/db/schema", () => {
  const makeTable = (name: string) =>
    new Proxy(
      {},
      { get: (_t, key) => (key === "__name" ? name : Symbol(String(key))) },
    );
  return {
    activities: makeTable("activities"),
    contacts: makeTable("contacts"),
    organizations: makeTable("organizations"),
    bookings: makeTable("bookings"),
    bookingContacts: makeTable("bookingContacts"),
    aiBookingSuggestions: makeTable("aiBookingSuggestions"),
  };
});

// Stub drizzle-orm operators — eq() captures the compared value so the db mock
// can filter suggestion rows by id; the rest return opaque symbols.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ __eq: value }),
  or: () => Symbol("or"),
  and: () => Symbol("and"),
  gte: () => Symbol("gte"),
  like: () => Symbol("like"),
  inArray: () => Symbol("inArray"),
  asc: () => Symbol("asc"),
  desc: () => Symbol("desc"),
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
const originalReplId = process.env.REPL_ID;
const originalAnthropicBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const originalAnthropicApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
let authorization = "";

beforeAll(() => {
  process.env.SESSION_SECRET = "ai-suggestions-test-secret-2026";
  process.env.REPL_ID = "ai-suggestions-test-repl";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";
  const issued = issueToken();
  if (!issued) throw new Error("Could not issue test token");
  authorization = `Bearer ${issued.token}`;
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  if (originalReplId === undefined) delete process.env.REPL_ID;
  else process.env.REPL_ID = originalReplId;
  if (originalAnthropicBaseUrl === undefined) delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  else process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = originalAnthropicBaseUrl;
  if (originalAnthropicApiKey === undefined) delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  else process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = originalAnthropicApiKey;
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

beforeEach(async () => {
  await clearSuggestions();
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
      contactId: null,
      organizationId: null,
    };
    await addSuggestion(suggestion);

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
  function parseSSEEvents(text: string): Record<string, unknown>[] {
    return text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  }

  it("returns SSE Content-Type and a done event when no records exist", async () => {
    activityRows.value = [];

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const events = parseSSEEvents(res.text);

    const fetchedEvent = events.find((e) => e.type === "fetched");
    expect(fetchedEvent).toBeDefined();
    expect(fetchedEvent!.count).toBe(0);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.totalRecords).toBe(0);
    expect(doneEvent!.totalSuggestions).toBe(0);
    expect(doneEvent!.hadErrors).toBe(false);
  });

  it("accepts a valid rangeMonths of 24", async () => {
    activityRows.value = [];

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization)
      .send({ rangeMonths: 24 });

    expect(res.status).toBe(200);
    const events = parseSSEEvents(res.text);
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it('accepts rangeMonths "all" (no date cutoff)', async () => {
    activityRows.value = [];

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization)
      .send({ rangeMonths: "all" });

    expect(res.status).toBe(200);
    const events = parseSSEEvents(res.text);
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("rejects an invalid rangeMonths with 400 before opening the stream", async () => {
    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization)
      .send({ rangeMonths: 7 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rangeMonths/);
  });

  it("streams a suggestion event when AI returns a future-dated suggestion", async () => {
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

    const events = parseSSEEvents(res.text);

    const suggestionEvent = events.find((e) => e.type === "suggestion");
    expect(suggestionEvent).toBeDefined();
    const sugg = suggestionEvent!.suggestion as Record<string, unknown>;
    expect(sugg.clientName).toBe("Smith Family");
    expect(sugg.confidence).toBe("high");
    expect(sugg.suggestedDate).toBe("2099-07-01");
    // End date is after start — should be preserved
    expect(sugg.suggestedDateEnd).toBe("2099-07-07");

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent!.totalSuggestions).toBe(1);
    expect(doneEvent!.hadErrors).toBe(false);
  });

  it("discards entire suggestions when the AI returns a past or absent start date", async () => {
    // This enforces the future-booking contract: a past start date means the
    // whole suggestion is rejected, not kept with a null date.
    activityRows.value = [
      {
        id: "act-row-past",
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
              tripDescription: "Past trip — must be rejected entirely",
              suggestedDate: "2020-01-01", // past — whole suggestion discarded
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

    const events = parseSSEEvents(res.text);

    // No suggestion event — the past-dated suggestion is discarded entirely
    expect(events.find((e) => e.type === "suggestion")).toBeUndefined();

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent!.totalSuggestions).toBe(0);
    expect(doneEvent!.hadErrors).toBe(false);
  });

  it("also rejects a suggestion whose end date precedes its start date", async () => {
    activityRows.value = [{ id: "r1", body: "trip", subject: null, kind: "act_history",
      timelineSortAt: new Date(), actRecordId: "act_activity:r1",
      contactFirstName: null, contactLastName: null, organizationName: null }];

    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify([{
        clientName: "Client",
        tripDescription: "Trip with bad end date",
        suggestedDate: "2099-08-10",
        suggestedDateEnd: "2099-08-05", // before start — cleared to null
        location: null, confidence: "medium",
        sourceSnippet: "next year", actRecordId: "act_activity:r1",
      }]) }],
    } as any);

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization);

    const events = parseSSEEvents(res.text);
    const sugg = events.find((e) => e.type === "suggestion")?.suggestion as Record<string, unknown> | undefined;
    expect(sugg).toBeDefined();
    expect(sugg!.suggestedDate).toBe("2099-08-10");
    expect(sugg!.suggestedDateEnd).toBeNull(); // cleared because it precedes start
  });

  it("reports hadErrors=true in the done event when an AI batch fails", async () => {
    activityRows.value = [
      { id: "r2", body: "annual trip", subject: null, kind: "act_history",
        timelineSortAt: new Date(), actRecordId: "act_activity:r2",
        contactFirstName: null, contactLastName: null, organizationName: null },
    ];

    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    vi.mocked(anthropic.messages.create).mockRejectedValueOnce(
      new Error("Anthropic API unavailable"),
    );

    const res = await request(app)
      .post("/api/ai-suggestions/analyze")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);

    const events = parseSSEEvents(res.text);

    // An error event must be present for the failed batch
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.message as string)).toContain("Anthropic API unavailable");

    // The done event must reflect that errors occurred — not clean success
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.hadErrors).toBe(true);
    expect(doneEvent!.totalSuggestions).toBe(0);
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
      contactId: null,
      organizationId: null,
    };
    await addSuggestion(suggestion);

    const res = await request(app)
      .post("/api/ai-suggestions/dismiss-test/dismiss")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe("dismissed");
  });

  it("returns 409 for an already-dismissed suggestion", async () => {
    await addSuggestion({
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
      contactId: null,
      organizationId: null,
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

    await addSuggestion({
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
      contactId: null,
      organizationId: null,
    });

    const res = await request(app)
      .post("/api/ai-suggestions/accept-test/accept")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe("accepted");
    expect(res.body.suggestion.bookingId).toBe("new-booking-uuid");
    expect(res.body.booking.id).toBe("new-booking-uuid");
  });

  it("carries linked organization/contact onto the created booking", async () => {
    insertedBooking.value = { id: "linked-booking-uuid", name: "Linked" };
    bookingInsertValues.value = null;
    bookingContactValues.value = null;

    await addSuggestion({
      id: "accept-linked",
      suggestedDate: "2099-07-01",
      suggestedDateEnd: null,
      clientName: "Linked Client",
      tripDescription: "Linked trip",
      location: "Aspen, CO",
      confidence: "high",
      sourceSnippet: "snippet",
      actRecordId: "act_activity:linked",
      status: "pending",
      bookingId: null,
      contactId: "contact-uuid-1",
      organizationId: "org-uuid-1",
    });

    const res = await request(app)
      .post("/api/ai-suggestions/accept-linked/accept")
      .set("Authorization", authorization);

    expect(res.status).toBe(200);
    expect(bookingInsertValues.value?.organizationId).toBe("org-uuid-1");
    expect(bookingContactValues.value).toMatchObject({
      bookingId: "linked-booking-uuid",
      contactId: "contact-uuid-1",
      isPrimary: true,
    });
    expect(res.body.booking.primaryContactId).toBe("contact-uuid-1");
  });

  it("returns 409 for an already-accepted suggestion", async () => {
    await addSuggestion({
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
