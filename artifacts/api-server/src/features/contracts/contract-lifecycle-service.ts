import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  activities,
  auditEntries,
  bookings,
  contractStatusEvents,
  contractFiles,
  contractVersions,
} from "@/db/schema";
import type { ContractVersionRecord } from "./contract-draft-service";

type ContractStatus = ContractVersionRecord["status"];
type BookingStatus = typeof bookings.$inferSelect.status;

export type ContractLifecycleState = {
  contractVersionId: string;
  bookingId: string;
  contractStatus: ContractStatus;
  bookingStatus: BookingStatus;
};

export interface ContractLifecycleRepository {
  get(contractVersionId: string): Promise<ContractLifecycleState | null>;
  commit(input: {
    contractVersionId: string;
    fromStatus: ContractStatus;
    toStatus: ContractStatus;
    bookingStatus: BookingStatus | null;
    actorId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<{ state: ContractLifecycleState; reused: boolean }>;
  confirmSignedFile(input: {
    contractVersionId: string;
    fileId: string;
    actorId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<{ state: ContractLifecycleState; reused: boolean }>;
}

export class ContractLifecycleServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ContractLifecycleServiceError";
  }
}

const transitions: Partial<Record<ContractStatus, readonly ContractStatus[]>> = {
  ready_for_adobe: ["sent_for_signature", "superseded"],
  sent_for_signature: ["partially_signed", "completed", "declined", "cancelled", "superseded"],
  partially_signed: ["completed", "declined", "cancelled", "superseded"],
};

const bookingProgress: readonly BookingStatus[] = [
  "new_lead", "researching", "contact_due", "contacted", "interested", "possible", "unlikely",
  "quote_sent", "pending_decision", "pending_contract", "contract_received", "confirmed", "completed", "renewal_due",
];
const terminalBookings = new Set<BookingStatus>(["declined", "cancelled"]);

export function bookingStatusAtLeast(current: BookingStatus, target: BookingStatus) {
  if (terminalBookings.has(current)) return true;
  return bookingProgress.indexOf(current) >= bookingProgress.indexOf(target);
}

export class ContractLifecycleService {
  constructor(private readonly repository: ContractLifecycleRepository, private readonly now: () => Date = () => new Date()) {}

  async confirmAdobeSent(input: { contractVersionId: string; actorId: string }) {
    const state = await this.repository.get(input.contractVersionId);
    if (!state) throw new ContractLifecycleServiceError("CONTRACT_VERSION_NOT_FOUND", "Contract version not found.");
    if (["sent_for_signature", "partially_signed", "completed"].includes(state.contractStatus)) {
      return { state, reused: true };
    }
    return this.transition({
      ...input,
      toStatus: "sent_for_signature",
      idempotencyKey: `adobe-sent:${input.contractVersionId}`,
    });
  }

  async transition(input: { contractVersionId: string; toStatus: ContractStatus; actorId: string; idempotencyKey: string }) {
    const state = await this.repository.get(input.contractVersionId);
    if (!state) throw new ContractLifecycleServiceError("CONTRACT_VERSION_NOT_FOUND", "Contract version not found.");
    if (!transitions[state.contractStatus]?.includes(input.toStatus)) {
      throw new ContractLifecycleServiceError("CONTRACT_TRANSITION_INVALID", `Cannot move this contract from ${state.contractStatus} to ${input.toStatus}.`);
    }
    const bookingStatus = input.toStatus === "sent_for_signature" && !bookingStatusAtLeast(state.bookingStatus, "pending_contract")
      ? "pending_contract" as const
      : null;
    return this.repository.commit({
      ...input,
      fromStatus: state.contractStatus,
      bookingStatus,
      now: this.now(),
    });
  }

  confirmSignedFile(input: { contractVersionId: string; fileId: string; actorId: string }) {
    return this.repository.confirmSignedFile({
      ...input,
      idempotencyKey: `signed-confirm:${input.contractVersionId}:${input.fileId}`,
      now: this.now(),
    });
  }
}

type Database = typeof database;

export class DrizzleContractLifecycleRepository implements ContractLifecycleRepository {
  constructor(private readonly database: Database) {}

  async get(contractVersionId: string) {
    const [row] = await this.database.select({
      contractVersionId: contractVersions.id,
      bookingId: contractVersions.bookingId,
      contractStatus: contractVersions.status,
      bookingStatus: bookings.status,
    }).from(contractVersions).innerJoin(bookings, eq(bookings.id, contractVersions.bookingId))
      .where(eq(contractVersions.id, contractVersionId)).limit(1);
    return row ?? null;
  }

  async commit(input: Parameters<ContractLifecycleRepository["commit"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [locked] = await transaction.select({
        contractVersionId: contractVersions.id,
        bookingId: contractVersions.bookingId,
        organizationId: contractVersions.organizationId,
        contractStatus: contractVersions.status,
        bookingStatus: bookings.status,
      }).from(contractVersions).innerJoin(bookings, eq(bookings.id, contractVersions.bookingId))
        .where(eq(contractVersions.id, input.contractVersionId)).for("update").limit(1);
      if (!locked) throw new ContractLifecycleServiceError("CONTRACT_VERSION_NOT_FOUND", "Contract version not found.");
      const [prior] = await transaction.select({ id: contractStatusEvents.id }).from(contractStatusEvents)
        .where(eq(contractStatusEvents.idempotencyKey, input.idempotencyKey)).limit(1);
      if (prior) return { state: {
        contractVersionId: locked.contractVersionId,
        bookingId: locked.bookingId,
        contractStatus: locked.contractStatus,
        bookingStatus: locked.bookingStatus,
      }, reused: true };
      if (locked.contractStatus !== input.fromStatus) throw new ContractLifecycleServiceError("CONTRACT_TRANSITION_STALE", "Contract status changed. Refresh and try again.");

      await transaction.insert(contractStatusEvents).values({
        contractVersionId: input.contractVersionId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        context: {},
        createdAt: input.now,
      });
      await transaction.update(contractVersions).set({ status: input.toStatus, updatedAt: input.now })
        .where(and(eq(contractVersions.id, input.contractVersionId), eq(contractVersions.status, input.fromStatus)));
      let bookingStatus = locked.bookingStatus;
      if (input.bookingStatus) {
        await transaction.update(bookings).set({ status: input.bookingStatus, updatedAt: input.now })
          .where(eq(bookings.id, locked.bookingId));
        bookingStatus = input.bookingStatus;
      }
      await transaction.insert(activities).values({
        organizationId: locked.organizationId,
        bookingId: locked.bookingId,
        kind: "contract_update",
        subject: "Contract status updated",
        status: input.toStatus,
        body: `Contract moved from ${input.fromStatus} to ${input.toStatus}.`,
        occurredAt: input.now,
        timelineSortAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      });
      await transaction.insert(auditEntries).values({
        entityType: "contract_version",
        entityId: input.contractVersionId,
        action: "contract_status_transition",
        before: { status: input.fromStatus },
        after: { status: input.toStatus, actorId: input.actorId },
        createdAt: input.now,
      });
      return { state: {
        contractVersionId: locked.contractVersionId,
        bookingId: locked.bookingId,
        contractStatus: input.toStatus,
        bookingStatus,
      }, reused: false };
    });
  }

  async confirmSignedFile(input: Parameters<ContractLifecycleRepository["confirmSignedFile"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [locked] = await transaction.select({
        contractVersionId: contractVersions.id,
        bookingId: contractVersions.bookingId,
        organizationId: contractVersions.organizationId,
        contractStatus: contractVersions.status,
        bookingStatus: bookings.status,
      }).from(contractVersions).innerJoin(bookings, eq(bookings.id, contractVersions.bookingId))
        .where(eq(contractVersions.id, input.contractVersionId)).for("update").limit(1);
      if (!locked) throw new ContractLifecycleServiceError("CONTRACT_VERSION_NOT_FOUND", "Contract version not found.");
      const [prior] = await transaction.select({ id: contractStatusEvents.id }).from(contractStatusEvents)
        .where(eq(contractStatusEvents.idempotencyKey, input.idempotencyKey)).limit(1);
      if (prior) return { state: {
        contractVersionId: locked.contractVersionId, bookingId: locked.bookingId,
        contractStatus: locked.contractStatus, bookingStatus: locked.bookingStatus,
      }, reused: true };
      const [file] = await transaction.select().from(contractFiles).where(and(
        eq(contractFiles.id, input.fileId),
        eq(contractFiles.contractVersionId, input.contractVersionId),
        eq(contractFiles.kind, "signed_completed"),
      )).for("update").limit(1);
      if (!file) throw new ContractLifecycleServiceError("CONTRACT_SIGNED_FILE_NOT_FOUND", "Signed contract file not found.");
      if (!["sent_for_signature", "partially_signed"].includes(locked.contractStatus)) {
        throw new ContractLifecycleServiceError("CONTRACT_COMPLETION_INVALID", "This contract cannot be completed from its current status.");
      }
      await transaction.update(contractFiles).set({ confirmedAt: input.now }).where(eq(contractFiles.id, file.id));
      await transaction.update(contractVersions).set({ status: "completed", updatedAt: input.now }).where(eq(contractVersions.id, input.contractVersionId));
      let bookingStatus = locked.bookingStatus;
      if (!bookingStatusAtLeast(locked.bookingStatus, "contract_received")) {
        bookingStatus = "contract_received";
        await transaction.update(bookings).set({ status: bookingStatus, updatedAt: input.now }).where(eq(bookings.id, locked.bookingId));
      }
      await transaction.insert(contractStatusEvents).values({
        contractVersionId: input.contractVersionId,
        fromStatus: locked.contractStatus,
        toStatus: "completed",
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        context: { confirmedFileId: file.id, signedRevision: file.revision },
        createdAt: input.now,
      });
      await transaction.insert(activities).values({
        organizationId: locked.organizationId, bookingId: locked.bookingId, kind: "contract_update",
        subject: "Signed contract completed", status: "completed",
        body: `Signed contract revision ${file.revision} was confirmed as completed.`,
        occurredAt: input.now, timelineSortAt: input.now, createdAt: input.now, updatedAt: input.now,
      });
      await transaction.insert(auditEntries).values({
        entityType: "contract_version", entityId: input.contractVersionId, action: "confirm_signed_contract",
        before: { status: locked.contractStatus },
        after: { status: "completed", confirmedFileId: file.id, actorId: input.actorId },
        createdAt: input.now,
      });
      return { state: {
        contractVersionId: locked.contractVersionId, bookingId: locked.bookingId,
        contractStatus: "completed" as const, bookingStatus,
      }, reused: false };
    });
  }
}
