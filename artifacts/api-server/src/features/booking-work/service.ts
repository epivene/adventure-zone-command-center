import { z } from "zod";
import {
  activeConnection,
  inputHash,
  requireConnectionScope,
  ConnectionError,
  transaction,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type SqlQuery,
} from "../chatgpt-connection/contracts";
import { OperationStore } from "../chatgpt-connection/operation-store";
import { receipt } from "../chatgpt-connection/lead-note-service";
import { profileRow } from "../chatgpt-connection/read-service";
import { BookingWorkRepository, WorkConflict } from "./repository";
import {
  createWorkSchema,
  patchWorkSchema,
  actorSchema,
  terminal,
  type CreateWork,
  type PatchWork,
  type WorkActor,
  type WorkFilter,
  type WorkActivity,
} from "./contracts";
export const workKeySchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    requestKey: z.string().trim().min(1).max(200),
  })
  .strict();
type Key = z.infer<typeof workKeySchema>;
export const recoverWorkSchema = workKeySchema.extend({
  previousConnectionId: z.string().uuid(),
});

export const previewBulkReleaseSchema = z.object({
  cards: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict()).min(1).max(50)
    .refine(cards => new Set(cards.map(c => c.id)).size === cards.length, "Duplicate cards"),
  requestKey: z.string().trim().min(1).max(200),
}).strict();
export const applyBulkReleaseSchema = z.object({
  previewId: z.string().uuid(),
  expectedContentHash: z.string().length(64),
  authorization: z.object({
    source: z.literal("current_owner_message"),
    instruction: z.string().trim().min(1).max(4000),
    confirmedRelease: z.literal(true),
  }).strict(),
  requestKey: z.string().trim().min(1).max(200),
}).strict();

export class BookingWorkService {
  constructor(private db: ConnectionDatabase) {}
  async list(p: ConnectionPrincipal, f: WorkFilter) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    return new BookingWorkRepository(this.db).list(f);
  }
  async read(p: ConnectionPrincipal, id: string) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    return this.get(this.db, z.string().uuid().parse(id));
  }
  private async get(tx: SqlQuery, id: string) {
    const a = await new BookingWorkRepository(tx).read(id);
    if (!a) throw new ConnectionError("WORK_NOT_FOUND", 404);
    return a;
  }
  private async current(tx: SqlQuery, k: { id: string; revision: number }) {
    const before = await this.get(tx, k.id);
    await profileRow(tx, before.profileId, true);
    const a = await this.get(tx, k.id);
    if (a.revision !== k.revision || a.profileId !== before.profileId)
      throw new WorkConflict(a);
    if (terminal(a.status)) throw new ConnectionError("WORK_CLOSED", 409);
    return a;
  }
  private async association(tx: SqlQuery, i: CreateWork) {
    await profileRow(tx, i.profileId, true);
    if (i.bookingId) {
      const b = (
        await tx.query(
          "SELECT organization_id,starts_at,ends_at FROM bookings WHERE id=$1",
          [i.bookingId],
        )
      ).rows[0];
      if (
        !b ||
        b.organization_id !== i.profileId ||
        !b.starts_at ||
        !(
          new Date(b.starts_at).getUTCFullYear() <= i.eventYear &&
          new Date(b.ends_at ?? b.starts_at).getUTCFullYear() >= i.eventYear
        )
      )
        throw new ConnectionError("WORK_BOOKING_MISMATCH", 409);
    }
  }
  private async links(tx: SqlQuery, a: WorkActivity, patch: PatchWork) {
    for (const l of patch.links ?? []) {
      if (l.kind === "email") continue;
      let rows: any[];
      if (l.kind === "draft")
        rows = (
          await tx.query(
            "SELECT id,content->>'eventYear' AS event_year,content->>'bookingId' AS booking_id FROM chatgpt_external_drafts WHERE id=$1 AND owner_id='owner' AND content->>'organizationId'=$2",
            [l.recordId, a.profileId],
          )
        ).rows;
      else if (l.kind === "document")
        rows = (
          await tx.query(
            "SELECT document_id,booking_id FROM business_document_links WHERE document_id=$1 AND organization_id=$2",
            [l.recordId, a.profileId],
          )
        ).rows;
      else
        rows = (
          await tx.query(
            "SELECT id,booking_id FROM follow_ups WHERE id=$1 AND organization_id=$2",
            [l.recordId, a.profileId],
          )
        ).rows;
      if (!rows.length) throw new ConnectionError("WORK_LINK_MISMATCH", 409);
      for (const row of rows) {
        if (row.event_year != null && Number(row.event_year) !== a.eventYear)
          throw new ConnectionError("WORK_LINK_MISMATCH", 409);
        if (row.booking_id) {
          try {
            await this.association(tx, {
              profileId: a.profileId,
              eventYear: a.eventYear,
              bookingId: row.booking_id,
              queue: a.queue,
              title: a.title,
              nextAction: a.nextAction,
            });
          } catch (e) {
            if (
              e instanceof ConnectionError &&
              e.code === "WORK_BOOKING_MISMATCH"
            )
              throw new ConnectionError("WORK_LINK_MISMATCH", 409);
            throw e;
          }
        }
      }
    }
  }
  async claim(
    p: ConnectionPrincipal,
    raw: CreateWork & { requestKey: string },
  ) {
    requireConnectionScope(p, "crm:append");
    const { requestKey, ...i } = raw;
    const input = createWorkSchema.parse(i);
    return new OperationStore(this.db).perform(
      p,
      "claim_booking_work",
      { requestKey },
      input,
      async (tx) => {
        await this.association(tx, input);
        const result = await new BookingWorkRepository(tx).createOrGet(input, {
          kind: "connection",
          id: p.connectionId,
        });
        return receipt(
          tx,
          result.activity.id,
          `/profiles/${result.activity.profileId}`,
          String(result.activity.revision),
          result,
        );
      },
    );
  }
  private async mutate(
    p: ConnectionPrincipal,
    operation: string,
    k: Key,
    patch: PatchWork,
    mode: "update" | "release" | "claim",
  ) {
    requireConnectionScope(p, "crm:update");
    workKeySchema.parse(k);
    return new OperationStore(this.db).perform(
      p,
      operation,
      { requestKey: k.requestKey },
      { id: k.id, revision: k.revision, patch },
      async (tx) => {
        const a = await this.current(tx, k);
        const mine =
          a.assignedTo?.kind === "connection" &&
          a.assignedTo.id === p.connectionId;
        if (mode === "claim" ? a.assignedTo !== null : !mine)
          throw new ConnectionError("WORK_NOT_ASSIGNED", 409, JSON.stringify({
            message: "No work was changed. Read the current card before recovering its assignment.",
            id: a.id, revision: a.revision, assignedTo: a.assignedTo,
            currentConnectionId: p.connectionId,
            recovery: a.assignedTo === null
              ? "Claim this unassigned card with claim_existing_booking_work using its current revision, then update using the returned revision."
              : "Read this card and try recover_booking_work with the exact revision and previousConnectionId only for a connection assignment. Recovery checks revocation and same owner/client on the server. If WORK_OWNER_HANDOFF_REQUIRED, use the owner handoff page. Do not take over active work or create a duplicate card.",
            href: `/settings/booking-work?profileId=${a.profileId}`,
          }));
        await this.links(tx, a, patch);
        const assigned =
          mode === "release"
            ? null
            : { kind: "connection" as const, id: p.connectionId };
        const b = await new BookingWorkRepository(tx).patch(
          k.id,
          k.revision,
          patch,
          assigned,
        );
        return receipt(
          tx,
          b.id,
          `/profiles/${b.profileId}`,
          String(b.revision),
          b,
        );
      },
    );
  }
  async update(p: ConnectionPrincipal, input: Key & { patch: PatchWork }) {
    const { patch, ...k } = input;
    return this.mutate(
      p,
      "update_booking_work",
      k,
      patchWorkSchema.parse(patch),
      "update",
    );
  }
  release(p: ConnectionPrincipal, k: Key) {
    return this.mutate(p, "release_booking_work", k, {}, "release");
  }
  claimExisting(p: ConnectionPrincipal, k: Key) {
    return this.mutate(p, "claim_existing_booking_work", k, {}, "claim");
  }
  async recover(p: ConnectionPrincipal, raw: z.infer<typeof recoverWorkSchema>) {
    requireConnectionScope(p, "crm:update");
    const { requestKey, ...input } = recoverWorkSchema.parse(raw);
    return new OperationStore(this.db).perform(p, "recover_booking_work", { requestKey }, input, async (tx) => {
      const a = await this.current(tx, input);
      if (a.assignedTo?.kind !== "connection" || a.assignedTo.id !== input.previousConnectionId)
        throw new ConnectionError("WORK_ASSIGNMENT_CHANGED", 409);
      // A timestamp is not proof of abandonment. Only a revoked connection
      // for this same owner and OAuth client can be recovered automatically.
      const old = (await tx.query(
        "SELECT id FROM chatgpt_connections WHERE id=$1 AND owner_id=$2 AND client_id=$3 AND revoked_at IS NOT NULL FOR UPDATE",
        [input.previousConnectionId, p.ownerId, p.clientId],
      )).rows[0];
      if (!old) throw new ConnectionError("WORK_OWNER_HANDOFF_REQUIRED", 409,
        "The prior connection is active or belongs to another account/client. No work changed. Use /settings/booking-work for an owner handoff.");
      const b = await new BookingWorkRepository(tx).patch(a.id, a.revision, {}, { kind: "connection", id: p.connectionId });
      return receipt(tx, b.id, `/settings/booking-work?profileId=${b.profileId}`, String(b.revision), {
        activity: b, previousAssignment: a.assignedTo, reason: "revoked_same_client_connection",
      });
    });
  }

  async previewBulkRelease(p: ConnectionPrincipal, raw: z.infer<typeof previewBulkReleaseSchema>) {
    requireConnectionScope(p, "crm:read");
    requireConnectionScope(p, "crm:update");
    const { requestKey, ...input } = previewBulkReleaseSchema.parse(raw);
    return new OperationStore(this.db).perform(p, "preview_booking_work_bulk_release", { requestKey }, input, async tx => {
      const cards: WorkActivity[] = [];
      for (const key of [...input.cards].sort((a,b) => a.id.localeCompare(b.id))) {
        const a = await this.current(tx, key);
        await this.releaseOwnerCheck(tx, p, a);
        cards.push(a);
      }
      const saved = await receipt(tx, cards[0].id, "/settings/booking-work", "preview", {
        cards, contentHash: inputHash(cards), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
      return saved;
    });
  }
  private async releaseOwnerCheck(tx: SqlQuery, p: ConnectionPrincipal, a: WorkActivity) {
    if (a.assignedTo?.kind !== "connection")
      throw new ConnectionError("WORK_NOT_CONNECTION_ASSIGNED", 409);
    const old = (await tx.query(
      "SELECT id FROM chatgpt_connections WHERE id=$1 AND owner_id=$2",
      [a.assignedTo.id, p.ownerId],
    )).rows[0];
    if (!old) throw new ConnectionError("WORK_OWNER_HANDOFF_REQUIRED", 409);
  }
  async applyBulkRelease(p: ConnectionPrincipal, raw: z.infer<typeof applyBulkReleaseSchema>) {
    requireConnectionScope(p, "crm:update");
    const { requestKey, ...input } = applyBulkReleaseSchema.parse(raw);
    return new OperationStore(this.db).perform(p, "apply_chat_authorized_booking_work_bulk_release", { requestKey }, input, async tx => {
      // A stored preview is bound to the requesting connection and operation.
      const row = (await tx.query(
        "SELECT receipt FROM chatgpt_operations WHERE id=$1 AND connection_id=$2 AND operation='preview_booking_work_bulk_release'",
        [input.previewId, p.connectionId],
      )).rows[0];
      const preview = row?.receipt?.value as {
        cards: WorkActivity[]; contentHash: string; expiresAt: string;
      } | undefined;
      if (!preview || !Number.isFinite(Date.parse(preview.expiresAt)) ||
          Date.parse(preview.expiresAt) < Date.now() || preview.contentHash !== input.expectedContentHash)
        throw new ConnectionError("WORK_RELEASE_PREVIEW_INVALID", 409);
      const before: WorkActivity[] = [];
      for (const key of preview.cards) {
        const a = await this.current(tx, key);
        await this.releaseOwnerCheck(tx, p, a);
        before.push(a);
      }
      if (inputHash(before) !== preview.contentHash)
        throw new ConnectionError("WORK_RELEASE_PREVIEW_CHANGED", 409);
      const after: WorkActivity[] = [];
      for (const a of before)
        after.push(await new BookingWorkRepository(tx).patch(a.id, a.revision, {}, null));
      return receipt(tx, input.previewId, "/settings/booking-work", "released", {
        previewId: input.previewId, authorization: input.authorization,
        released: after.length, before, after,
      });
    });
  }

  async ownerCreate(raw: CreateWork) {
    const i = createWorkSchema.parse(raw);
    return transaction(this.db, async (tx) => {
      await this.association(tx, i);
      return new BookingWorkRepository(tx).createOrGet(i, {
        kind: "owner",
        id: "owner",
      });
    });
  }
  async ownerUpdate(id: string, revision: number, raw: PatchWork) {
    const patch = patchWorkSchema.parse(raw);
    return transaction(this.db, async (tx) => {
      const a = await this.current(tx, { id, revision });
      await this.links(tx, a, patch);
      return new BookingWorkRepository(tx).patch(
        id,
        revision,
        patch,
        a.assignedTo,
      );
    });
  }
  async reassign(id: string, revision: number, raw: WorkActor | null) {
    const actor = raw === null ? null : actorSchema.parse(raw);
    return transaction(this.db, async (tx) => {
      await this.current(tx, { id, revision });
      if (actor?.kind === "owner" && actor.id !== "owner")
        throw new ConnectionError("WORK_INVALID_ACTOR", 409);
      if (
        actor?.kind === "connection" &&
        !(
          await tx.query(
            "SELECT id FROM chatgpt_connections WHERE id::text=$1 AND owner_id='owner' AND revoked_at IS NULL",
            [actor.id],
          )
        ).rows.length
      )
        throw new ConnectionError("WORK_INVALID_ACTOR", 409);
      return new BookingWorkRepository(tx).patch(id, revision, {}, actor);
    });
  }
}


