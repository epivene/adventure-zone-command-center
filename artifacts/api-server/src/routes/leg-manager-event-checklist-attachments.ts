import express, { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  eventChecklistAttachments,
  eventChecklistItemResults,
  eventChecklistRuns,
} from "@/db/schema";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const storage = new GoogleCloudLegManagerObjectStorage();
const uuid = z.string().uuid();
const metadataSchema = z.object({
  id: uuid,
  clientMutationId: uuid,
  mimeType: z.string().trim().min(1).max(120),
}).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function resultContext(resultId: string) {
  return (
    (
      await db
        .select({
          resultId: eventChecklistItemResults.id,
          runId: eventChecklistRuns.id,
          bookingId: eventChecklistRuns.bookingId,
          legId: eventChecklistRuns.legId,
        })
        .from(eventChecklistItemResults)
        .innerJoin(
          eventChecklistRuns,
          eq(eventChecklistRuns.id, eventChecklistItemResults.runId),
        )
        .where(eq(eventChecklistItemResults.id, resultId))
        .limit(1)
    )[0] ?? null
  );
}

async function attachmentContext(attachmentId: string) {
  return (
    (
      await db
        .select({
          attachment: eventChecklistAttachments,
          bookingId: eventChecklistRuns.bookingId,
          legId: eventChecklistRuns.legId,
        })
        .from(eventChecklistAttachments)
        .innerJoin(
          eventChecklistItemResults,
          eq(eventChecklistItemResults.id, eventChecklistAttachments.resultId),
        )
        .innerJoin(
          eventChecklistRuns,
          eq(eventChecklistRuns.id, eventChecklistItemResults.runId),
        )
        .where(eq(eventChecklistAttachments.id, attachmentId))
        .limit(1)
    )[0] ?? null
  );
}

router.post(
  "/manager/events/:bookingId/checklist-results/:resultId/attachments",
  requireManager,
  async (req, res): Promise<void> => {
    const bookingId = param(req.params.bookingId);
    const resultId = param(req.params.resultId);
    const parsed = metadataSchema.safeParse(req.body);
    if (!uuid.safeParse(bookingId).success || !uuid.safeParse(resultId).success || !parsed.success) {
      res.status(400).json({ error: "Invalid checklist photo metadata." });
      return;
    }

    const context = await resultContext(resultId);
    if (!context) {
      res.status(404).json({ error: "Checklist item not found." });
      return;
    }
    if (
      context.bookingId !== bookingId ||
      context.legId !== req.legManager!.legId
    ) {
      res.status(403).json({ error: "Checklist item is outside your assigned event." });
      return;
    }

    const existing = (
      await db
        .select()
        .from(eventChecklistAttachments)
        .where(eq(eventChecklistAttachments.clientMutationId, parsed.data.clientMutationId))
        .limit(1)
    )[0];
    if (existing) {
      if (existing.resultId !== resultId || existing.id !== parsed.data.id) {
        res.status(409).json({ error: "That photo mutation is already linked to another checklist item." });
        return;
      }
      res.json({ attachment: existing, idempotent: true });
      return;
    }

    const [attachment] = await db
      .insert(eventChecklistAttachments)
      .values({
        id: parsed.data.id,
        resultId,
        mimeType: parsed.data.mimeType,
        clientMutationId: parsed.data.clientMutationId,
      })
      .onConflictDoNothing()
      .returning();

    if (!attachment) {
      const retry = (
        await db
          .select()
          .from(eventChecklistAttachments)
          .where(
            and(
              eq(eventChecklistAttachments.id, parsed.data.id),
              eq(eventChecklistAttachments.resultId, resultId),
            ),
          )
          .limit(1)
      )[0];
      if (!retry) {
        res.status(409).json({ error: "Could not create checklist photo metadata." });
        return;
      }
      res.json({ attachment: retry, idempotent: true });
      return;
    }

    res.status(201).json({ attachment, idempotent: false });
  },
);

router.put(
  "/manager/events/:bookingId/checklist-attachments/:attachmentId/image",
  requireManager,
  express.raw({ type: "image/*", limit: "12mb" }),
  async (req, res): Promise<void> => {
    const bookingId = param(req.params.bookingId);
    const attachmentId = param(req.params.attachmentId);
    if (!uuid.safeParse(bookingId).success || !uuid.safeParse(attachmentId).success) {
      res.status(400).json({ error: "Invalid checklist photo." });
      return;
    }

    const context = await attachmentContext(attachmentId);
    if (!context) {
      res.status(404).json({ error: "Checklist photo metadata not found." });
      return;
    }
    if (
      context.bookingId !== bookingId ||
      context.legId !== req.legManager!.legId
    ) {
      res.status(403).json({ error: "Checklist photo is outside your assigned event." });
      return;
    }

    const bytes = req.body instanceof Buffer
      ? new Uint8Array(req.body)
      : new Uint8Array();
    if (!bytes.length) {
      res.status(400).json({ error: "Checklist photo image is required." });
      return;
    }

    const rawContentType = req.headers["content-type"];
    const mimeType = Array.isArray(rawContentType)
      ? rawContentType[0] ?? context.attachment.mimeType
      : rawContentType ?? context.attachment.mimeType;
    const storageKey = `checklist/${context.legId}/${bookingId}/${attachmentId}`;

    try {
      await storage.put(storageKey, bytes, mimeType);
      const [attachment] = await db
        .update(eventChecklistAttachments)
        .set({
          storageKey,
          uploadedAt: new Date(),
        })
        .where(eq(eventChecklistAttachments.id, attachmentId))
        .returning();
      res.json({ attachment });
    } catch (error) {
      req.log.error({ error, attachmentId, bookingId }, "Failed to upload checklist photo");
      res.status(503).json({ error: "Checklist photo upload failed. The checklist answer is still saved." });
    }
  },
);

export default router;
