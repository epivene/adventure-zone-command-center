import { sql } from "drizzle-orm";
import type { db as Database } from "@workspace/db";
import type { Pool } from "pg";
import type { ActionIntent, RunContext, ToolResult } from "./contracts";
import type { MutationAdapter } from "./action-executor";
import { validateRecordAction } from "./record-tools";
import { OfficeProfileEditor } from "../office/office-profile-editor";
import { FollowUpService } from "../follow-ups/follow-up-service";
import { DrizzleFollowUpRepository } from "../follow-ups/follow-up-repository";
export function productionRecordAdapters(
  db: typeof Database,
  pool: Pool,
): Record<string, MutationAdapter> {
  const receipt = (
    kind: string,
    id: string,
    profileId: string,
    data: unknown,
  ): ToolResult => ({
    status: "ok",
    data,
    evidence: [],
    receipts: [
      {
        kind,
        id,
        href: `/profiles/${profileId}`,
        verifiedAt: new Date().toISOString(),
      },
    ],
    code: null,
  });
  const adapters: Record<string, MutationAdapter> = {};
  for (const kind of [
    "update_profile",
    "add_profile_note",
    "create_followup",
    "update_followup",
  ]) {
    adapters[kind] = {
      async validate(context, intent) {
        validateRecordAction(kind, intent.arguments);
        const target =
          kind === "update_followup"
            ? (
                await pool.query(
                  `SELECT organization_id FROM follow_ups WHERE id=$1`,
                  [intent.targetId],
                )
              ).rows[0]?.organization_id
            : intent.targetId;
        if (!target || !context.selection.organizationIds.includes(target))
          throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
        if (
          !(
            await pool.query(
              `SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL`,
              [target],
            )
          ).rows[0]
        )
          throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
      },
      async apply(context, intent) {
        return db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${intent.id},0))`,
          );
          const previous = (
            await tx.execute(
              sql`SELECT result FROM assistant_workspace_mutation_results WHERE action_id=${intent.id}::uuid AND actor_id=${context.actor.id}`,
            )
          ).rows[0];
          if (previous) return previous.result as ToolResult;
          const args = validateRecordAction(kind, intent.arguments) as any;
          let profileId = intent.targetId;
          let output: ToolResult;
          if (kind === "update_followup") {
            const current = (
              await tx.execute(
                sql`SELECT * FROM follow_ups WHERE id=${intent.targetId}::uuid FOR UPDATE`,
              )
            ).rows[0] as any;
            if (!current) throw new Error("ASSISTANT_FOLLOWUP_NOT_FOUND");
            profileId = current.organization_id;
            if (
              !intent.expectedRevision ||
              new Date(current.updated_at).toISOString() !==
                intent.expectedRevision
            )
              throw new Error("ASSISTANT_VERSION_CONFLICT");
          }
          const before = (
            await tx.execute(
              sql`SELECT * FROM organizations WHERE id=${profileId}::uuid AND consolidated_into_id IS NULL FOR UPDATE`,
            )
          ).rows[0] as any;
          if (!before || !context.selection.organizationIds.includes(profileId))
            throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
          if (
            kind === "update_profile" &&
            (!intent.expectedRevision ||
              new Date(before.updated_at).toISOString() !==
                intent.expectedRevision)
          )
            throw new Error("ASSISTANT_VERSION_CONFLICT");
          if (context.signal.aborted) throw new Error("ASSISTANT_CANCELLED");
          if (kind === "update_profile") {
            await new OfficeProfileEditor(
              tx as unknown as typeof Database,
            ).updateProfile(profileId, args, {
              accountId: context.actor.id,
              displayName: "Owner assistant",
            });
            const after = (
              await tx.execute(
                sql`SELECT * FROM organizations WHERE id=${profileId}::uuid`,
              )
            ).rows[0];
            output = receipt(kind, profileId, profileId, { before, after });
          } else if (kind === "add_profile_note") {
            const saved = await new OfficeProfileEditor(
              tx as unknown as typeof Database,
            ).addNote(profileId, args.body, {
              accountId: context.actor.id,
              displayName: "Owner assistant",
            });
            if (!saved.ok) throw new Error("ASSISTANT_NOTE_FAILED");
            output = receipt(kind, saved.value.id, profileId, saved.value);
          } else {
            if (args.bookingId) {
              const booking = (
                await tx.execute(
                  sql`SELECT id FROM bookings WHERE id=${args.bookingId}::uuid AND organization_id=${profileId}::uuid`,
                )
              ).rows[0];
              if (!booking) throw new Error("ASSISTANT_BOOKING_MISMATCH");
            }
            if (args.contactId) {
              const contact = (
                await tx.execute(
                  sql`SELECT contact_id FROM organization_contacts WHERE contact_id=${args.contactId}::uuid AND organization_id=${profileId}::uuid AND active=true`,
                )
              ).rows[0];
              if (!contact) throw new Error("ASSISTANT_CONTACT_MISMATCH");
            }
            const service = new FollowUpService(
              new DrizzleFollowUpRepository(tx as unknown as typeof Database),
            );
            const saved =
              kind === "create_followup"
                ? await service.create(
                    {
                      ...args,
                      organizationId: profileId,
                      dueAt: new Date(args.dueAt),
                    },
                    { preserveExisting: true, idempotencyId: intent.id },
                  )
                : await service.edit({
                    ...args,
                    followUpId: intent.targetId,
                    dueAt: new Date(args.dueAt),
                  });
            if (!saved.ok) throw new Error("ASSISTANT_FOLLOWUP_FAILED");
            const readback = (
              await tx.execute(
                sql`SELECT * FROM follow_ups WHERE id=${saved.value.id}::uuid`,
              )
            ).rows[0];
            output = receipt(kind, saved.value.id, profileId, readback);
          }
          await tx.execute(
            sql`INSERT INTO assistant_workspace_mutation_results(action_id,actor_id,result) VALUES(${intent.id}::uuid,${context.actor.id},${JSON.stringify(output)}::jsonb)`,
          );
          return output;
        });
      },
      async reconcile(context, intent) {
        const r = await pool.query(
          `SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2`,
          [intent.id, context.actor.id],
        );
        return (
          r.rows[0]?.result ?? {
            status: "uncertain",
            data: null,
            evidence: [],
            receipts: [],
            code: "ASSISTANT_ACTION_RECONCILIATION_REQUIRED",
          }
        );
      },
    };
  }
  return adapters;
}
