/**
 * AI history analysis routes — suggest future bookings from Act! history.
 *
 * POST /api/ai-suggestions/analyze  — SSE: fetch + analyze last 12 months of history
 * GET  /api/ai-suggestions           — list current session suggestions
 * POST /api/ai-suggestions/:id/accept  — create draft booking from suggestion
 * POST /api/ai-suggestions/:id/dismiss — mark suggestion dismissed
 */

import { Router, type IRouter } from "express";
import { analyzeHistory, type ActivityRecord } from "@/features/ai-suggestions/suggestion-analyzer";
import {
  getSuggestions,
  getSuggestion,
  updateSuggestion,
} from "@/features/ai-suggestions/suggestion-store";

const router: IRouter = Router();

// ─── POST /ai-suggestions/analyze ────────────────────────────────────────────
// SSE endpoint. Fetches the last 12 months of Act! activity records from DB,
// sends them to Claude in batches, streams progress and suggestion events back.

router.post("/ai-suggestions/analyze", async (req, res): Promise<void> => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const [{ db }, schema, orm] = await Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);

    const { activities, contacts, organizations } = schema;
    const { or, eq, and, gte } = orm;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const rows = await (db as any)
      .select({
        id: activities.id,
        body: activities.body,
        subject: activities.subject,
        kind: activities.kind,
        timelineSortAt: activities.timelineSortAt,
        actRecordId: activities.actRecordId,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        organizationName: organizations.name,
      })
      .from(activities)
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      .leftJoin(organizations, eq(activities.organizationId, organizations.id))
      .where(
        and(
          or(eq(activities.kind, "act_history"), eq(activities.kind, "calendar")),
          gte(activities.timelineSortAt, twelveMonthsAgo),
        ),
      );

    const records: ActivityRecord[] = rows;

    send({ type: "fetched", count: records.length });

    await analyzeHistory(records, (event) => send(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    send({ type: "error", message });
    res.end();
    return;
  }

  res.end();
});

// ─── GET /ai-suggestions ──────────────────────────────────────────────────────

router.get("/ai-suggestions", (_req, res): void => {
  res.json(getSuggestions());
});

// ─── POST /ai-suggestions/:id/accept ─────────────────────────────────────────
// Creates a draft booking pre-filled from the suggestion, marks it accepted.

router.post("/ai-suggestions/:id/accept", async (req, res): Promise<void> => {
  const { id } = req.params;
  const suggestion = getSuggestion(id);
  if (!suggestion) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }
  if (suggestion.status !== "pending") {
    res.status(409).json({ error: `Suggestion already ${suggestion.status}` });
    return;
  }

  try {
    const [{ db }, schema] = await Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
    ]);

    const { bookings } = schema;

    // Parse city / region from the location string if provided
    const locationParts = suggestion.location
      ? suggestion.location.split(",").map((s) => s.trim())
      : [];
    const city = locationParts[0] ?? "TBD";
    const region = locationParts[1] ?? "TBD";

    // Build a short name from description
    const nameBase = suggestion.clientName
      ? `${suggestion.clientName} — ${suggestion.tripDescription}`
      : suggestion.tripDescription;
    const name = nameBase.slice(0, 200);

    const startsAt = suggestion.suggestedDate
      ? new Date(`${suggestion.suggestedDate}T00:00:00Z`)
      : null;
    const endsAt = suggestion.suggestedDateEnd
      ? new Date(`${suggestion.suggestedDateEnd}T00:00:00Z`)
      : null;

    const notes = [
      "AI-suggested from Act! history.",
      suggestion.clientName ? `Client: ${suggestion.clientName}` : null,
      `Confidence: ${suggestion.confidence}`,
      `Source: "${suggestion.sourceSnippet}"`,
    ]
      .filter(Boolean)
      .join("\n");

    const [booking] = await (db as any)
      .insert(bookings)
      .values({
        name,
        city,
        region,
        status: "new_lead",
        probability: "possible",
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
        notes,
      })
      .returning();

    const updated = updateSuggestion(id, {
      status: "accepted",
      bookingId: booking.id,
    });

    res.json({ suggestion: updated, booking });
  } catch (err) {
    req.log.error({ err }, "Failed to create booking from suggestion");
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// ─── POST /ai-suggestions/:id/dismiss ────────────────────────────────────────

router.post("/ai-suggestions/:id/dismiss", (req, res): void => {
  const { id } = req.params;
  const suggestion = getSuggestion(id);
  if (!suggestion) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }
  if (suggestion.status !== "pending") {
    res.status(409).json({ error: `Suggestion already ${suggestion.status}` });
    return;
  }
  const updated = updateSuggestion(id, { status: "dismissed" });
  res.json({ suggestion: updated });
});

export default router;
