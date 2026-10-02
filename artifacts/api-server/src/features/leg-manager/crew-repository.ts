import { and, asc, desc, eq } from "drizzle-orm";
import { capacityEnforcementEnabled } from "../outreach-planner/outreach-allocation";
import { reconcileCapacityFacts } from "../outreach-planner/outreach-commitments";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { crewManagerNotes, crewWorkers, crewWorkHistory } from "@/db/schema";
import { crewWorkerLegMemberships } from "./crew-worker-membership-schema";
import {
  normalizeCrewPhone,
  type CrewManagerNote,
  type CrewWorker,
  type CrewWorkerWithHistory,
  type CrewWorkHistory,
  type CrewRehireStatus,
} from "./crew-types";
export type CrewWorkHistoryPatch = Partial<
  Pick<CrewWorkHistory, "role" | "startedAt" | "endedAt" | "rating" | "note">
>;
export type CrewManagerNotePatch = Pick<CrewManagerNote, "note">;
export interface CrewRepositoryStore {
  listWorkers(): Promise<CrewWorker[]>;
  listWorkHistory(): Promise<CrewWorkHistory[]>;
  listManagerNotes(): Promise<CrewManagerNote[]>;
  getWorker(id: string): Promise<CrewWorker | null>;
  addWorkerToLeg(workerId: string, legId: string): Promise<void>;
  workerBelongsToLeg(workerId: string, legId: string): Promise<boolean>;
  deleteWorker(workerId: string): Promise<boolean>;
  getWorkHistory(id: string): Promise<CrewWorkHistory | null>;
  updateWorkHistory(
    id: string,
    patch: CrewWorkHistoryPatch,
  ): Promise<CrewWorkHistory | null>;
  deleteWorkHistory(id: string): Promise<boolean>;
  getManagerNote(id: string): Promise<CrewManagerNote | null>;
  updateManagerNote(
    id: string,
    patch: CrewManagerNotePatch,
  ): Promise<CrewManagerNote | null>;
  deleteManagerNote(id: string): Promise<boolean>;
}
export async function listWorkersForManager(
  store: CrewRepositoryStore,
  _managerLegId: string,
): Promise<CrewWorkerWithHistory[]> {
  const [workers, history, notes] = await Promise.all([
    store.listWorkers(),
    store.listWorkHistory(),
    store.listManagerNotes(),
  ]);
  return workers.map((worker) => ({
    ...worker,
    workHistory: history.filter((entry) => entry.workerId === worker.id),
    managerNotes: notes.filter((note) => note.workerId === worker.id),
  }));
}
export async function updateWorkHistoryAsManager(
  store: CrewRepositoryStore,
  managerLegId: string,
  historyId: string,
  patch: CrewWorkHistoryPatch,
) {
  const existing = await store.getWorkHistory(historyId);
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const };
  if (existing.legId !== managerLegId)
    return { ok: false as const, code: "FORBIDDEN" as const };
  const entry = await store.updateWorkHistory(historyId, patch);
  if (!entry) return { ok: false as const, code: "NOT_FOUND" as const };
  return { ok: true as const, entry };
}
export async function deleteWorkHistoryAsManager(
  store: CrewRepositoryStore,
  managerLegId: string,
  historyId: string,
) {
  const existing = await store.getWorkHistory(historyId);
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const };
  if (existing.legId !== managerLegId)
    return { ok: false as const, code: "FORBIDDEN" as const };
  if (!(await store.deleteWorkHistory(historyId)))
    return { ok: false as const, code: "NOT_FOUND" as const };
  return { ok: true as const };
}
export async function updateManagerNoteAsManager(
  store: CrewRepositoryStore,
  managerLegId: string,
  noteId: string,
  note: string,
) {
  const existing = await store.getManagerNote(noteId);
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const };
  if (existing.legId !== managerLegId)
    return { ok: false as const, code: "FORBIDDEN" as const };
  const updated = await store.updateManagerNote(noteId, { note: note.trim() });
  if (!updated) return { ok: false as const, code: "NOT_FOUND" as const };
  return { ok: true as const, note: updated };
}
export async function deleteManagerNoteAsManager(
  store: CrewRepositoryStore,
  managerLegId: string,
  noteId: string,
) {
  const existing = await store.getManagerNote(noteId);
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const };
  if (existing.legId !== managerLegId)
    return { ok: false as const, code: "FORBIDDEN" as const };
  if (!(await store.deleteManagerNote(noteId)))
    return { ok: false as const, code: "NOT_FOUND" as const };
  return { ok: true as const };
}
export class DrizzleCrewRepository implements CrewRepositoryStore {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}
  private factMutation<T>(
    work: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  ) {
    return capacityEnforcementEnabled()
      ? reconcileCapacityFacts(this.database, "crew-inventory", (tx) =>
          work(tx as NodePgDatabase<typeof schema>),
        )
      : work(this.database);
  }
  async listWorkers() {
    return (await this.database
      .select()
      .from(crewWorkers)
      .orderBy(asc(crewWorkers.name))) as CrewWorker[];
  }
  async listWorkHistory() {
    return (await this.database
      .select()
      .from(crewWorkHistory)
      .orderBy(desc(crewWorkHistory.startedAt))) as CrewWorkHistory[];
  }
  async listManagerNotes() {
    return (await this.database
      .select()
      .from(crewManagerNotes)
      .orderBy(desc(crewManagerNotes.createdAt))) as CrewManagerNote[];
  }
  async getWorker(id: string) {
    return ((
      await this.database
        .select()
        .from(crewWorkers)
        .where(eq(crewWorkers.id, id))
        .limit(1)
    )[0] ?? null) as CrewWorker | null;
  }
  async addWorkerToLeg(workerId: string, legId: string) {
    await this.factMutation(async (tx) => {
      await tx
        .insert(crewWorkerLegMemberships)
        .values({ workerId, legId })
        .onConflictDoNothing({
          target: [
            crewWorkerLegMemberships.workerId,
            crewWorkerLegMemberships.legId,
          ],
        });
    });
  }
  async workerBelongsToLeg(workerId: string, legId: string) {
    const membership = (
      await this.database
        .select({ workerId: crewWorkerLegMemberships.workerId })
        .from(crewWorkerLegMemberships)
        .where(
          and(
            eq(crewWorkerLegMemberships.workerId, workerId),
            eq(crewWorkerLegMemberships.legId, legId),
          ),
        )
        .limit(1)
    )[0];
    if (membership) return true;
    const history = await this.database
      .select({ legId: crewWorkHistory.legId })
      .from(crewWorkHistory)
      .where(eq(crewWorkHistory.workerId, workerId));
    if (history.some((entry) => entry.legId === legId)) return true;
    const notes = await this.database
      .select({ legId: crewManagerNotes.legId })
      .from(crewManagerNotes)
      .where(eq(crewManagerNotes.workerId, workerId));
    return notes.some((entry) => entry.legId === legId);
  }
  async deleteWorker(workerId: string) {
    const work = async (tx: NodePgDatabase<typeof schema>) => {
      const existing = (
        await tx
          .select({ id: crewWorkers.id })
          .from(crewWorkers)
          .where(eq(crewWorkers.id, workerId))
          .limit(1)
      )[0];
      if (!existing) return false;
      await tx
        .delete(crewManagerNotes)
        .where(eq(crewManagerNotes.workerId, workerId));
      await tx
        .delete(crewWorkHistory)
        .where(eq(crewWorkHistory.workerId, workerId));
      await tx
        .delete(crewWorkerLegMemberships)
        .where(eq(crewWorkerLegMemberships.workerId, workerId));
      await tx.delete(crewWorkers).where(eq(crewWorkers.id, workerId));
      return true;
    };
    return capacityEnforcementEnabled()
      ? this.factMutation(work)
      : this.database.transaction(work);
  }
  async getWorkHistory(id: string) {
    return ((
      await this.database
        .select()
        .from(crewWorkHistory)
        .where(eq(crewWorkHistory.id, id))
        .limit(1)
    )[0] ?? null) as CrewWorkHistory | null;
  }
  async updateWorkHistory(id: string, patch: CrewWorkHistoryPatch) {
    return ((
      await this.database
        .update(crewWorkHistory)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(crewWorkHistory.id, id))
        .returning()
    )[0] ?? null) as CrewWorkHistory | null;
  }
  async deleteWorkHistory(id: string) {
    return (
      (
        await this.database
          .delete(crewWorkHistory)
          .where(eq(crewWorkHistory.id, id))
          .returning({ id: crewWorkHistory.id })
      ).length > 0
    );
  }
  async getManagerNote(id: string) {
    return ((
      await this.database
        .select()
        .from(crewManagerNotes)
        .where(eq(crewManagerNotes.id, id))
        .limit(1)
    )[0] ?? null) as CrewManagerNote | null;
  }
  async updateManagerNote(id: string, patch: CrewManagerNotePatch) {
    return ((
      await this.database
        .update(crewManagerNotes)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(crewManagerNotes.id, id))
        .returning()
    )[0] ?? null) as CrewManagerNote | null;
  }
  async deleteManagerNote(id: string) {
    return (
      (
        await this.database
          .delete(crewManagerNotes)
          .where(eq(crewManagerNotes.id, id))
          .returning({ id: crewManagerNotes.id })
      ).length > 0
    );
  }
  async createWorker(input: {
    name: string;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
    region?: string | null;
    locationText?: string | null;
    rehireStatus?: CrewRehireStatus;
  }) {
    return this.factMutation(
      async (tx) =>
        (
          await tx
            .insert(crewWorkers)
            .values({
              name: input.name.trim(),
              phone: input.phone?.trim() || null,
              normalizedPhone: normalizeCrewPhone(input.phone),
              email: input.email?.trim() || null,
              city: input.city?.trim() || null,
              region: input.region?.trim() || null,
              locationText: input.locationText?.trim() || null,
              rehireStatus: input.rehireStatus ?? "undecided",
            })
            .returning()
        )[0],
    );
  }
  async findPossibleMatches(input: { name: string; phone?: string | null }) {
    const phone = normalizeCrewPhone(input.phone),
      name = input.name.trim().toLocaleLowerCase();
    return (await this.listWorkers()).filter(
      (w) =>
        (phone && w.normalizedPhone === phone) ||
        w.name.trim().toLocaleLowerCase() === name,
    );
  }
  async createWorkHistory(input: {
    workerId: string;
    legId: string;
    bookingId?: string | null;
    tripId?: string | null;
    role: string;
    startedAt: Date;
    endedAt?: Date | null;
    rating?: number | null;
    note?: string | null;
    clientMutationId: string;
  }) {
    await this.addWorkerToLeg(input.workerId, input.legId);
    const rows = await this.database
      .insert(crewWorkHistory)
      .values({
        id: input.clientMutationId,
        workerId: input.workerId,
        legId: input.legId,
        bookingId: input.bookingId ?? null,
        tripId: input.tripId ?? null,
        role: input.role.trim(),
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        rating: input.rating ?? null,
        note: input.note?.trim() || null,
      })
      .onConflictDoNothing({ target: crewWorkHistory.id })
      .returning();
    if (rows[0]) return rows[0];
    return (
      await this.database
        .select()
        .from(crewWorkHistory)
        .where(eq(crewWorkHistory.id, input.clientMutationId))
        .limit(1)
    )[0];
  }
  async createManagerNote(input: {
    workerId: string;
    legId: string;
    bookingId?: string | null;
    note: string;
    clientMutationId: string;
  }) {
    await this.addWorkerToLeg(input.workerId, input.legId);
    const rows = await this.database
      .insert(crewManagerNotes)
      .values({
        id: input.clientMutationId,
        workerId: input.workerId,
        legId: input.legId,
        bookingId: input.bookingId ?? null,
        note: input.note.trim(),
      })
      .onConflictDoNothing({ target: crewManagerNotes.id })
      .returning();
    if (rows[0]) return rows[0];
    return (
      await this.database
        .select()
        .from(crewManagerNotes)
        .where(eq(crewManagerNotes.id, input.clientMutationId))
        .limit(1)
    )[0];
  }
  async updateRehireStatus(workerId: string, rehireStatus: CrewRehireStatus) {
    return this.factMutation(
      async (tx) =>
        (
          await tx
            .update(crewWorkers)
            .set({ rehireStatus, updatedAt: new Date() })
            .where(eq(crewWorkers.id, workerId))
            .returning()
        )[0] ?? null,
    );
  }
}
