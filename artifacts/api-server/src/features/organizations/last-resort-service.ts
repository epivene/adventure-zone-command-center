import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
import { and, eq, inArray, ne } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, organizations } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { bookingStatusValues } from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
import type { SetLastResortInput } from "@/features/organizations/last-resort-input";

type DrizzleDatabase = typeof database;

function lastResortSnapshot(record: typeof organizations.$inferSelect) {
  return {
    lastResort: record.lastResort,
    lastResortReason: record.lastResortReason,
    lastResortChangedAt: record.lastResortChangedAt,
  };
}

/**
 * Marks or clears Last Resort atomically. Enabling Last Resort also lowers
 * current/open bookings for the profile to Unlikely, while preserving closed
 * historical bookings such as completed, cancelled, and declined work.
 */
export async function setOrganizationLastResort(
  database: Pick<DrizzleDatabase, "transaction">,
  input: SetLastResortInput,
  changedAt: Date,
): Promise<boolean> {
  return commitmentTransaction(database, async (transaction) => {
    const [before] = await transaction
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .for("update");
    if (!before) return false;

    const [updated] = await transaction
      .update(organizations)
      .set({
        lastResort: input.enabled,
        lastResortReason: input.enabled ? input.reason : null,
        lastResortChangedAt: changedAt,
        updatedAt: changedAt,
      })
      .where(eq(organizations.id, input.organizationId))
      .returning();
    if (!updated) throw new Error("Could not update the organization.");

    if (input.enabled) {
      const activeStatuses = bookingStatusValues.filter(isActiveStatus);
      const bookingsToLower = await transaction
        .select({ id: bookings.id, probability: bookings.probability })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, input.organizationId),
            inArray(bookings.status, activeStatuses),
            ne(bookings.probability, "unlikely"),
          ),
        )
        .for("update");

      if (bookingsToLower.length) {
        await transaction
          .update(bookings)
          .set({ probability: "unlikely", updatedAt: changedAt })
          .where(inArray(bookings.id, bookingsToLower.map((booking) => booking.id)));

        for (const booking of bookingsToLower) {
          await recordAuditEntry(transaction, {
            entityType: "booking",
            entityId: booking.id,
            action: "probability_auto_last_resort",
            before: { probability: booking.probability },
            after: { probability: "unlikely" },
          });
        }
      }
    }

    await recordAuditEntry(transaction, {
      entityType: "organization",
      entityId: input.organizationId,
      action: input.enabled ? "last_resort_enabled" : "last_resort_cleared",
      before: lastResortSnapshot(before),
      after: lastResortSnapshot(updated),
    });

    return true;
  });
}
