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

    const { activities, contacts, organizations, activityAssociations } = schema;
    const { inArray, eq, and, gte, isNull, isNotNull, alias } = orm;

    // Compute the lookback cutoff, or null for all history.
    let cutoff: Date | null = null;
    if (rangeMonths !== null) {
      cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - rangeMonths);
    }

    const kindFilter = cutoff
      ? and(
          inArray(activities.kind, ["act_history", "note", "calendar"]),
          gte(activities.timelineSortAt, cutoff),
        )
      : inArray(activities.kind, ["act_history", "note", "calendar"]);

    // Many imported Act! records are linked via activity_associations (bridge
    // table) rather than direct FK columns. We resolve contact/org IDs from
    // both sources: direct FK wins, association falls back when FK is null.
    // One activity can have multiple associations; we pick the first contact
    // and first organization via a left join filtered by which ID column is
    // non-null (the schema uses a "exactly one non-null" check constraint,
    // so there is no associationType column).
    const assocContact = alias(activityAssociations, "assoc_contact");
    const assocOrg = alias(activityAssociations, "assoc_org");
    const assocContactPerson = alias(contacts, "assoc_contact_person");
    const assocOrgCompany = alias(organizations, "assoc_org_company");

    const rows = await (db as any)
      .selectDistinctOn([activities.id], {
        id: activities.id,
        body: activities.body,
        subject: activities.subject,
        kind: activities.kind,
        timelineSortAt: activities.timelineSortAt,
        actRecordId: activities.actRecordId,
        // Prefer direct FK; fall back to association-linked ID
        contactId: orm.sql`COALESCE(${activities.contactId}, ${assocContact.contactId})`,
        organizationId: orm.sql`COALESCE(${activities.organizationId}, ${assocOrg.organizationId})`,
        // Name from whichever contact source resolved first
        contactFirstName: orm.sql`COALESCE(${contacts.firstName}, ${assocContactPerson.firstName})`,
        contactLastName: orm.sql`COALESCE(${contacts.lastName}, ${assocContactPerson.lastName})`,
        organizationName: orm.sql`COALESCE(${organizations.name}, ${assocOrgCompany.name})`,
      })
      .from(activities)
      // Direct FK joins
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      .leftJoin(organizations, eq(activities.organizationId, organizations.id))
      // Association-based contact fallback (only when direct FK is absent).
      // activity_associations uses nullable ID columns with exactly-one-non-null
      // constraint — there is no associationType column.
      .leftJoin(
        assocContact,
        and(
          eq(assocContact.activityId, activities.id),
          isNotNull(assocContact.contactId),
          isNull(activities.contactId),
        ),
      )
      .leftJoin(
        assocContactPerson,
        eq(assocContactPerson.id, assocContact.contactId),
      )
      // Association-based organization fallback (only when direct FK is absent)
      .leftJoin(
        assocOrg,
        and(
          eq(assocOrg.activityId, activities.id),
          isNotNull(assocOrg.organizationId),
          isNull(activities.organizationId),
        ),
      )
      .leftJoin(
        assocOrgCompany,
        eq(assocOrgCompany.id, assocOrg.organizationId),
      )
      .where(kindFilter);

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
    const booking = await (db as any).transaction(async (tx: any) => {
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
