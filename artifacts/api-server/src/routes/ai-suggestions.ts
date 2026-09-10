import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
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

    const { sql: sqlTag } = orm;

    // Compute the lookback cutoff, or null for all history.
    let cutoff: Date | null = null;
    if (rangeMonths !== null) {
      cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - rangeMonths);
    }

    // Many imported Act! records are linked via activity_associations (bridge
    // table) rather than direct FK columns on activities. We use raw SQL to
    // resolve contact/org IDs from both sources in one query:
    //   - direct FK wins when present
    //   - association-linked ID falls back when direct FK is null
    // DISTINCT ON ensures one row per activity even when multiple associations exist.
    const cutoffClause = cutoff
      ? sqlTag`AND a.timeline_sort_at >= ${cutoff}`
      : sqlTag``;

    const rows: ActivityRecord[] = (
      await (db as any).execute(sqlTag`
        SELECT DISTINCT ON (a.id)
          a.id,
          a.body,
          a.subject,
          a.kind,
          a.timeline_sort_at      AS "timelineSortAt",
          a.act_record_id         AS "actRecordId",
          COALESCE(a.contact_id,      ac_assoc.contact_id)      AS "contactId",
          COALESCE(a.organization_id, ao_assoc.organization_id) AS "organizationId",
          COALESCE(c.first_name,  ac.first_name)  AS "contactFirstName",
          COALESCE(c.last_name,   ac.last_name)   AS "contactLastName",
          COALESCE(o.name,        ao.name)         AS "organizationName"
        FROM activities a
        -- Direct FK joins
        LEFT JOIN contacts      c  ON c.id  = a.contact_id
        LEFT JOIN organizations o  ON o.id  = a.organization_id
        -- Association fallback: pick one contact link when direct FK is null
        LEFT JOIN activity_associations ac_assoc
               ON ac_assoc.activity_id = a.id
              AND ac_assoc.contact_id IS NOT NULL
              AND a.contact_id IS NULL
        LEFT JOIN contacts ac ON ac.id = ac_assoc.contact_id
        -- Association fallback: pick one organization link when direct FK is null
        LEFT JOIN activity_associations ao_assoc
               ON ao_assoc.activity_id = a.id
              AND ao_assoc.organization_id IS NOT NULL
              AND a.organization_id IS NULL
        LEFT JOIN organizations ao ON ao.id = ao_assoc.organization_id
        WHERE a.kind IN ('act_history', 'note', 'calendar')
        ${cutoffClause}
      `)
    ).rows.map((r: Record<string, unknown>) => ({
      ...r,
      // Raw SQL returns timestamps as strings; analyzer expects Date objects.
      timelineSortAt: r.timelineSortAt
        ? new Date(r.timelineSortAt as string)
        : null,
    }));

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
    const [{ db }, schema, { eq: eqOp }] = await Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);

    const { bookings, bookingContacts } = schema;

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

    // Create the booking and, when the suggestion carries a linked contact,
    // the booking_contacts row required by the primary-contact FK — in one
    // transaction so a failure can't leave a half-linked booking.
    const booking = await commitmentTransaction(db, async (tx: any) => {
      const [created] = await tx
        .insert(bookings)
        .values({
          name,
          city,
          region,
          status: "new_lead",
          probability: "possible",
          ...(startsAt ? { startsAt } : {}),
          ...(endsAt ? { endsAt } : {}),
          ...(suggestion.organizationId
            ? { organizationId: suggestion.organizationId }
            : {}),
          notes,
        })
        .returning();

      if (!suggestion.contactId) return created;

      await tx.insert(bookingContacts).values({
        bookingId: created.id,
        contactId: suggestion.contactId,
        isPrimary: true,
        source: "ai_suggestion",
      });
      const [withContact] = await tx
        .update(bookings)
        .set({ primaryContactId: suggestion.contactId })
        .where(eqOp(bookings.id, created.id))
        .returning();
      return withContact;
    });

    const updated = await updateSuggestion(id, {
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
