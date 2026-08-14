/**
 * AI history analysis routes — suggest future bookings from Act! history.
 *
 * POST /api/ai-suggestions/analyze  — SSE: fetch + analyze history (12/24/36 months or all)
 * GET  /api/ai-suggestions           — list current session suggestions
 * POST /api/ai-suggestions/:id/accept  — create draft booking from suggestion
 * POST /api/ai-suggestions/:id/dismiss — mark suggestion dismissed
 */

import { Router, type IRouter } from "express";
import { NOT_CONFIGURED_ERROR } from "@/features/ai-suggestions/ai-client";
import { analyzeHistory, type ActivityRecord } from "@/features/ai-suggestions/suggestion-analyzer";
import {
  getSuggestions,
  getSuggestion,
  updateSuggestion,
} from "@/features/ai-suggestions/suggestion-store";

const router: IRouter = Router();

// ─── POST /ai-suggestions/analyze ────────────────────────────────────────────
// SSE endpoint. Fetches Act! activity records from DB for the chosen range,
// sends them to Claude in batches, streams progress and suggestion events back.

const ALLOWED_RANGES = [12, 24, 36] as const;

router.post("/ai-suggestions/analyze", async (req, res): Promise<void> => {
  // ── Parse the lookback range: 12 / 24 / 36 months, or "all" for no limit.
  const rawRange = (req.body as { rangeMonths?: unknown } | undefined)?.rangeMonths;
  let rangeMonths: number | null; // null = all history
  if (rawRange === undefined || rawRange === null) {
    rangeMonths = 12; // default preserves previous behaviour
  } else if (rawRange === "all") {
    rangeMonths = null;
  } else if (
    typeof rawRange === "number" &&
    (ALLOWED_RANGES as readonly number[]).includes(rawRange)
  ) {
    rangeMonths = rawRange;
  } else {
    res.status(400).json({
      error: `Invalid rangeMonths — expected one of ${ALLOWED_RANGES.join(", ")} or "all"`,
    });
    return;
  }

  // ── Pre-flight: check AI provider availability before opening the SSE stream.
  // This lets us return a proper 503 JSON response (not an SSE error event)
  // when no API key is configured — cleaner for the client to handle.
  {
    const { createAiClient } = await import("@/features/ai-suggestions/ai-client");
    try {
      await createAiClient();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === NOT_CONFIGURED_ERROR) {
        res.status(503).json({
          error: (err as Error).message,
        });
        return;
      }
      // Any other unexpected startup error — still 503
      res.status(503).json({ error: "AI provider could not be initialised" });
      return;
    }
  }

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
    const { inArray, eq, and, gte } = orm;

    // Compute the lookback cutoff, or null for all history.
    let cutoff: Date | null = null;
    if (rangeMonths !== null) {
      cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - rangeMonths);
    }

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
        // Analyze all imported Act! timeline records: history entries, notes,
        // and scheduled calendar activities. Calendar activities (past fairs,
        // meetings) are often the strongest signal for recurring bookings.
        // There is no feedback loop: accepted suggestions become bookings,
        // never activity rows, so nothing AI-generated is ever re-scanned.
        // "approved_suggestion" kind is deliberately not included.
        cutoff
          ? and(
              inArray(activities.kind, ["act_history", "note", "calendar"]),
              gte(activities.timelineSortAt, cutoff),
            )
          : inArray(activities.kind, ["act_history", "note", "calendar"]),
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

router.get("/ai-suggestions", async (req, res): Promise<void> => {
  try {
    res.json(await getSuggestions());
  } catch (err) {
    req.log.error({ err }, "Failed to load AI suggestions");
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

// ─── POST /ai-suggestions/:id/accept ─────────────────────────────────────────
// Creates a draft booking pre-filled from the suggestion, marks it accepted.

router.post("/ai-suggestions/:id/accept", async (req, res): Promise<void> => {
  const { id } = req.params;
    const suggestion = await getSuggestion(id);
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

    const updated = await updateSuggestion(id, { status: "dismissed" });

    res.json({ suggestion: updated, booking });
  } catch (err) {
    req.log.error({ err }, "Failed to create booking from suggestion");
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// ─── POST /ai-suggestions/:id/dismiss ────────────────────────────────────────

router.post("/ai-suggestions/:id/dismiss", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const suggestion = await getSuggestion(id);
    if (!suggestion) {
      res.status(404).json({ error: "Suggestion not found" });
      return;
    }
    if (suggestion.status !== "pending") {
      res.status(409).json({ error: `Suggestion already ${suggestion.status}` });
      return;
    }
    const updated = await updateSuggestion(id, { status: "dismissed" });
    res.json({ suggestion: updated });
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss suggestion");
    res.status(500).json({ error: "Failed to dismiss suggestion" });
  }
});

export default router;
