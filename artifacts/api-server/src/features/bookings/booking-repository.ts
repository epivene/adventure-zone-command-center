import type { ResolvedDates } from "../booking-date-repair/date-evidence";
import { allocationEnabled } from "@/features/outreach-planner/outreach-allocation";
import { commitmentTransaction, reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { db as database } from "@/db/client";
import {
  auditEntries,
  activities,
  bookingOpportunities,
  bookingContacts,
  bookingPackageSelections,
  bookingResourceAssignments,
  bookingResourcePackageAttributions,
  bookingSpecialRequests,
  bookings,
  bookingOperationalWindows,
  contacts,
  callSessions,
  followUps,
  organizations,
  packageTemplates,
  resourcePackageTags,
  resources,
  travelLegs,
} from "@/db/schema";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";
import type { BookingEditInput } from "@/features/bookings/booking-input";
import { bookingEditPreservesFollowUpPlan } from "@/features/bookings/booking-edit-policy";
import { finalFollowUpDecision } from "./final-follow-up-decision";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type { BookingSpecialRequest } from "@/features/packages/package-repository";
import type { ResourceWarning } from "@/features/resources/resource-types";

export type Booking = {
  id: string;
  name: string;
  city: string;
  region: string;
  status: BookingStatus;
  probability: Probability;
};

export type FollowUp = {
  id: string;
  bookingId: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  outcome: string | null;
  nextFollowUpId: string | null;
};

export type FollowUpError =
  | { code: "FOLLOW_UP_NOT_FOUND" }
  | { code: "FOLLOW_UP_ALREADY_COMPLETED" }
  | { code: "FOLLOW_UP_HAS_CALL" };

export type FollowUpRecord = {
  id: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
};

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type CreateFollowUpInput = {
  bookingId: string;
  kind: string;
  dueAt: Date;
};

export type UpdateBookingStatusInput = {
  bookingId: string;
  status: BookingStatus;
};

export type BookingListRecord = {
  dateProvenance?: ResolvedDates;
  id: string;
  name: string;
  organization: { id: string; name: string } | null;
  city: string;
  region: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: BookingStatus;
  probability: Probability;
  travelLeg: { id: string; name: string; color: string } | null;
  nextAction: { id: string; kind: string; dueAt: Date } | null;
};

export type BookingDetail = {
  dateProvenance?: ResolvedDates;
  booking: typeof bookings.$inferSelect;
  organization: typeof organizations.$inferSelect | null;
  contact: typeof contacts.$inferSelect | null;
  people: BookingPerson[];
  travelLeg: typeof travelLegs.$inferSelect | null;
  followUps: (typeof followUps.$inferSelect)[];
  auditEntries: (typeof auditEntries.$inferSelect)[];
};

export type BookingPerson = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
};

export type BookingPackageOption = {
  id: string;
  code: string;
  name: string;
  baseAttractionCount: number;
  active: boolean;
  selected: boolean;
};

export type BookingResourceOption = {
  id: string;
  code: string;
  name: string;
  status: "available" | "unavailable" | "maintenance" | "archived";
  countsAsAttraction: boolean;
  packageTemplateIds: string[];
  assigned: boolean;
  assignmentId: string | null;
  attributionSource: "inferred" | "manual";
  attributedPackageIds: string[];
};

export type BookingPackageResourceEditorModel = {
  bookingId: string;
  physicalAttractionTotal: number | null;
  attractionTotalApprovalReason: string | null;
  packageOptions: BookingPackageOption[];
  resourceOptions: BookingResourceOption[];
  assignedAttractionCount: number;
  specialRequests: BookingSpecialRequest[];
  warnings: ResourceWarning[];
};

export interface BookingTransaction {
  recordFollowUpCompletion?(input:{bookingId:string;outcome:string;nextAction:{kind:string;dueAt:Date}|null;completedAt:Date;noFurtherActionReason?:string}):Promise<void>;
  findFollowUpWithBookingForUpdate(
    followUpId: string,
  ): Promise<{ followUp: FollowUp; booking: Booking } | null>;
  createBooking(input: Omit<Booking, "id">): Promise<Booking>;
  completeFollowUp(
    followUpId: string,
    input: { outcome: string; completedAt: Date },
  ): Promise<FollowUp>;
  createFollowUp(input: CreateFollowUpInput): Promise<FollowUp>;
  linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void>;
  updateBookingStatus(input: UpdateBookingStatusInput): Promise<Booking>;
  createAuditEntry(input: AuditEntry): Promise<void>;
}

export interface BookingRepository {
  createBooking(input: Omit<Booking, "id">): Promise<Booking>;
  transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>, followUpId?: string): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzleWriter = Pick<DrizzleDatabase, "select" | "insert" | "update">;

function toBooking(record: typeof bookings.$inferSelect): Booking {
  return {
    id: record.id,
    name: record.name,
    city: record.city,
    region: record.region,
    status: record.status,
    probability: record.probability,
  };
}

function toFollowUp(record: typeof followUps.$inferSelect): FollowUp {
  if (!record.bookingId) {
    throw new Error("Follow-up is not linked to a booking.");
  }
  return {
    id: record.id,
    bookingId: record.bookingId,
    kind: record.kind,
    dueAt: record.dueAt,
    completedAt: record.completedAt,
    outcome: record.outcome,
    nextFollowUpId: record.nextFollowUpId,
  };
}

const editableBookingFields = [
  "name",
  "venueName",
  "address1",
  "city",
  "region",
  "postalCode",
  "latitude",
  "longitude",
  "startsAt",
  "endsAt",
  "status",
  "probability",
  "travelLegId",
  "notes",
] as const;

function bookingEditSnapshot(
  record: Pick<
    typeof bookings.$inferSelect,
    (typeof editableBookingFields)[number]
  >,
) {
  return Object.fromEntries(
    editableBookingFields.map((field) => [field, record[field]]),
  );
}

export class BookingEditInvariantError extends Error {
  constructor() {
    super("NEXT_ACTION_REQUIRED");
    this.name = "BookingEditInvariantError";
  }
}

class DrizzleBookingTransaction implements BookingTransaction {
  constructor(private readonly database: DrizzleWriter) {}

  async findFollowUpWithBookingForUpdate(followUpId: string) {
    const [record] = await this.database
      .select({ followUp: followUps, booking: bookings })
      .from(followUps)
      .innerJoin(bookings, eq(followUps.bookingId, bookings.id))
      .where(eq(followUps.id, followUpId))
      .limit(1)
      .for("update");

    if (!record) return null;
    return {
      followUp: toFollowUp(record.followUp),
      booking: toBooking(record.booking),
    };
  }

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    const [booking] = await this.database.insert(bookings).values(input).returning();
    if (!booking) throw new Error("Could not create booking.");
    return toBooking(booking);
  }

  async completeFollowUp(
    followUpId: string,
    input: { outcome: string; completedAt: Date },
  ): Promise<FollowUp> {
    const [followUp] = await this.database
      .update(followUps)
      .set({ ...input, updatedAt: input.completedAt })
      .where(eq(followUps.id, followUpId))
      .returning();

    if (!followUp) throw new Error("Follow-up is missing.");
    return toFollowUp(followUp);
  }

  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
    const [followUp] = await this.database.insert(followUps).values(input).returning();
    if (!followUp) throw new Error("Could not create follow-up.");
    return toFollowUp(followUp);
  }

  async linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void> {
    await this.database
      .update(followUps)
      .set({ nextFollowUpId, updatedAt: new Date() })
      .where(eq(followUps.id, followUpId));
  }

  async updateBookingStatus(input: UpdateBookingStatusInput): Promise<Booking> {
    const [booking] = await this.database
      .update(bookings)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(bookings.id, input.bookingId))
      .returning();

    if (!booking) throw new Error("Booking is missing.");
    const status=input.status==="confirmed"?"booked":input.status==="declined"?"declined":input.status==="cancelled"?"cancelled":null;
    if(status)await this.database.update(bookingOpportunities).set({status,updatedAt:new Date()}).where(eq(bookingOpportunities.bookingId,input.bookingId));
    return toBooking(booking);
  }

  async recordFollowUpCompletion(input:{bookingId:string;outcome:string;nextAction:{kind:string;dueAt:Date}|null;completedAt:Date;noFurtherActionReason?:string}) {
    const [booking]=await this.database.select({organizationId:bookings.organizationId,contactId:bookings.primaryContactId}).from(bookings).where(eq(bookings.id,input.bookingId));
    if(!booking)return;
    const linked=await this.database.update(bookingOpportunities).set({nextActionKind:input.nextAction?.kind??null,nextActionDueAt:input.nextAction?.dueAt??null,updatedAt:input.completedAt}).where(eq(bookingOpportunities.bookingId,input.bookingId)).returning({id:bookingOpportunities.id});
    await this.database.insert(activities).values({...booking,bookingId:input.bookingId,kind:"note",subject:input.noFurtherActionReason?`Next step: booking:${input.bookingId}`:"Follow-up completed",status:input.noFurtherActionReason?"no_further_action":null,body:`Follow-up completed: ${input.outcome}. ${input.nextAction?`Next action: ${input.nextAction.kind}, due ${input.nextAction.dueAt.toISOString()}.`:input.noFurtherActionReason?`No further action: ${input.noFurtherActionReason}.`:"Review the next action in Today."}`,occurredAt:input.completedAt,timelineSortAt:input.completedAt});
    if(input.noFurtherActionReason)for(const opportunity of linked)await this.database.insert(activities).values({...booking,bookingId:input.bookingId,kind:"note",subject:`Next step: opportunity:${opportunity.id}`,status:"no_further_action",body:`No further action: ${input.noFurtherActionReason}.`,occurredAt:input.completedAt,timelineSortAt:input.completedAt});
  }

  async createAuditEntry(input: AuditEntry): Promise<void> {
    await recordAuditEntry(this.database, input);
  }
}

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    return commitmentTransaction(this.database, async tx => {
      const [booking] = await tx.insert(bookings).values(input).returning();
      if (!booking) throw new Error("Could not create booking.");
      return toBooking(booking);
    });
  }

  async transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>, followUpId?: string): Promise<T> {
    const context=allocationEnabled() && followUpId ? (await this.database.select({bookingId:followUps.bookingId}).from(followUps).where(eq(followUps.id,followUpId)).limit(1))[0] : null;
    return commitmentTransaction(this.database, (transaction) =>
      operation(new DrizzleBookingTransaction(transaction)),
      {source:"booking-follow-up",bookingIds:context?.bookingId?[context.bookingId]:[]},
    );
  }

  async updateFollowUp(
    followUpId: string,
    input: { kind: string; dueAt: Date },
  ): Promise<Result<FollowUpRecord, FollowUpError>> {
    return commitmentTransaction(this.database, async (transaction) => {
      const [followUp] = await transaction
        .select()
        .from(followUps)
        .where(eq(followUps.id, followUpId))
        .limit(1)
        .for("update");
      if (!followUp) return err({ code: "FOLLOW_UP_NOT_FOUND" });
      if (followUp.completedAt) return err({ code: "FOLLOW_UP_ALREADY_COMPLETED" });
      const [updated] = await transaction
        .update(followUps)
        .set({ kind: input.kind, dueAt: input.dueAt, updatedAt: new Date() })
        .where(eq(followUps.id, followUpId))
        .returning();
      if (!updated) throw new Error("Follow-up disappeared while being edited.");
      return ok({ id: updated.id, kind: updated.kind, dueAt: updated.dueAt, completedAt: updated.completedAt });
    });
  }

  async deleteFollowUp(followUpId: string): Promise<Result<void, FollowUpError>> {
    return commitmentTransaction(this.database, async (transaction) => {
      const [followUp] = await transaction
        .select()
        .from(followUps)
        .where(eq(followUps.id, followUpId))
        .limit(1)
        .for("update");
      if (!followUp) return err({ code: "FOLLOW_UP_NOT_FOUND" });
      if (followUp.completedAt) return err({ code: "FOLLOW_UP_ALREADY_COMPLETED" });
      const [session] = await transaction
        .select({ id: callSessions.id })
        .from(callSessions)
        .where(eq(callSessions.followUpId, followUpId))
        .limit(1);
      if (session) return err({ code: "FOLLOW_UP_HAS_CALL" });
      await transaction
        .update(followUps)
        .set({ nextFollowUpId: null, updatedAt: new Date() })
        .where(eq(followUps.nextFollowUpId, followUpId));
      await transaction.delete(followUps).where(eq(followUps.id, followUpId));
      return ok(undefined);
    });
  }

  async listBookings(): Promise<BookingListRecord[]> {
    const [records, openFollowUps] = await Promise.all([
      this.database
        .select({ booking: bookings, organization: organizations, travelLeg: travelLegs, dateProvenance: sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})` })
        .from(bookings)
        .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
        .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
        .leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId))
        .orderBy(desc(bookings.updatedAt)),
      this.database
        .select()
        .from(followUps)
        .where(isNull(followUps.completedAt))
        .orderBy(asc(followUps.dueAt)),
    ]);

    const nextActionByBooking = new Map<
      string,
      { id: string; kind: string; dueAt: Date }
    >();
    for (const followUp of openFollowUps) {
      if (!followUp.bookingId) continue;
      if (!nextActionByBooking.has(followUp.bookingId)) {
        nextActionByBooking.set(followUp.bookingId, {
          id: followUp.id,
          kind: followUp.kind,
          dueAt: followUp.dueAt,
        });
      }
    }

    return records.map(({ booking, organization, travelLeg, dateProvenance }) => ({
      dateProvenance,
      id: booking.id,
      name: booking.name,
      organization: organization
        ? { id: organization.id, name: organization.name }
        : null,
      city: booking.city,
      region: booking.region,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      probability: booking.probability,
      travelLeg: travelLeg
        ? { id: travelLeg.id, name: travelLeg.name, color: travelLeg.color }
        : null,
      nextAction: nextActionByBooking.get(booking.id) ?? null,
    }));
  }

  async getBookingDetail(bookingId: string): Promise<BookingDetail | null> {
    const [record] = await this.database
      .select({
        booking: bookings,
        organization: organizations,
        contact: contacts,
        travelLeg: travelLegs,
        dateProvenance:sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})`,
      })
      .from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(contacts, eq(bookings.primaryContactId, contacts.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
        .leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!record) return null;

    const [bookingFollowUps, people] = await Promise.all([
      this.database
        .select()
        .from(followUps)
        .where(eq(followUps.bookingId, bookingId))
        .orderBy(desc(followUps.dueAt)),
      this.database
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          role: bookingContacts.role,
          isPrimary: bookingContacts.isPrimary,
        })
        .from(bookingContacts)
        .innerJoin(contacts, eq(bookingContacts.contactId, contacts.id))
        .where(eq(bookingContacts.bookingId, bookingId))
        .orderBy(
          desc(bookingContacts.isPrimary),
          asc(bookingContacts.role),
          asc(contacts.lastName),
          asc(contacts.firstName),
          asc(contacts.id),
        ),
    ]);
    const followUpIds = bookingFollowUps.map((followUp) => followUp.id);
    const auditFilter =
      followUpIds.length > 0
        ? or(
            and(
              eq(auditEntries.entityType, "booking"),
              eq(auditEntries.entityId, bookingId),
            ),
            and(
              eq(auditEntries.entityType, "follow_up"),
              inArray(auditEntries.entityId, followUpIds),
            ),
          )
        : and(
            eq(auditEntries.entityType, "booking"),
            eq(auditEntries.entityId, bookingId),
          );
    const history = await this.database
      .select()
      .from(auditEntries)
      .where(auditFilter)
      .orderBy(desc(auditEntries.createdAt));

    return {
      ...record,
      people: people.map((person) => ({
        id: person.id,
        name: `${person.firstName} ${person.lastName}`.trim(),
        role: person.role,
        isPrimary: person.isPrimary,
      })),
      followUps: bookingFollowUps,
      auditEntries: history,
    };
  }

  async getPackageResourceEditorModel(
    bookingId: string,
    warnings: ResourceWarning[] = [],
  ): Promise<BookingPackageResourceEditorModel | null> {
    const [booking] = await this.database
      .select({
        id: bookings.id,
        physicalAttractionTotal: bookings.physicalAttractionTotal,
        attractionTotalApprovalReason: bookings.attractionTotalApprovalReason,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!booking) return null;

    const [
      selections,
      templateRows,
      assignmentRows,
      tagRows,
      attributionRows,
      requests,
    ] = await Promise.all([
      this.database
        .select({ packageTemplateId: bookingPackageSelections.packageTemplateId })
        .from(bookingPackageSelections)
        .where(eq(bookingPackageSelections.bookingId, bookingId)),
      this.database
        .select()
        .from(packageTemplates)
        .orderBy(asc(packageTemplates.name), asc(packageTemplates.id)),
      this.database
        .select({ assignment: bookingResourceAssignments, resource: resources })
        .from(bookingResourceAssignments)
        .innerJoin(
          resources,
          eq(bookingResourceAssignments.resourceId, resources.id),
        )
        .where(eq(bookingResourceAssignments.bookingId, bookingId))
        .orderBy(asc(resources.name), asc(resources.id)),
      this.database
        .select()
        .from(resourcePackageTags),
      this.database
        .select({
          assignmentId:
            bookingResourcePackageAttributions.bookingResourceAssignmentId,
          packageTemplateId:
            bookingResourcePackageAttributions.packageTemplateId,
        })
        .from(bookingResourcePackageAttributions)
        .innerJoin(
          bookingResourceAssignments,
          eq(
            bookingResourcePackageAttributions.bookingResourceAssignmentId,
            bookingResourceAssignments.id,
          ),
        )
        .where(eq(bookingResourceAssignments.bookingId, bookingId)),
      this.database
        .select()
        .from(bookingSpecialRequests)
        .where(eq(bookingSpecialRequests.bookingId, bookingId))
        .orderBy(desc(bookingSpecialRequests.createdAt), asc(bookingSpecialRequests.id)),
    ]);
    const selectedIds = new Set(
      selections.map(({ packageTemplateId }) => packageTemplateId),
    );
    const assignedByResource = new Map(
      assignmentRows.map((row) => [row.resource.id, row]),
    );
    const allResourceRows = await this.database
      .select()
      .from(resources)
      .orderBy(asc(resources.name), asc(resources.id));
    const visibleResources = allResourceRows.filter(
      (resource) =>
        resource.status === "available" || assignedByResource.has(resource.id),
    );

    const resourceOptions = visibleResources.map((resource) => {
      const row = assignedByResource.get(resource.id);
      const packageTemplateIds = tagRows
        .filter(({ resourceId }) => resourceId === resource.id)
        .map(({ packageTemplateId }) => packageTemplateId)
        .sort();
      const persistedAttributions = row
        ? attributionRows
            .filter(({ assignmentId }) => assignmentId === row.assignment.id)
            .map(({ packageTemplateId }) => packageTemplateId)
            .sort()
        : [];
      const attributionSource = row?.assignment.attributionSource ?? "inferred";
      return {
        id: resource.id,
        code: resource.code,
        name: resource.name,
        status: resource.status,
        countsAsAttraction: resource.countsAsAttraction,
        packageTemplateIds,
        assigned: Boolean(row),
        assignmentId: row?.assignment.id ?? null,
        attributionSource,
        attributedPackageIds:
          row && attributionSource === "inferred"
            ? packageTemplateIds.filter((packageId) => selectedIds.has(packageId))
            : persistedAttributions,
      };
    });

    return {
      bookingId,
      physicalAttractionTotal: booking.physicalAttractionTotal,
      attractionTotalApprovalReason: booking.attractionTotalApprovalReason,
      packageOptions: templateRows
        .filter((template) => template.active || selectedIds.has(template.id))
        .map((template) => ({
          id: template.id,
          code: template.code,
          name: template.name,
          baseAttractionCount: template.baseAttractionCount,
          active: template.active,
          selected: selectedIds.has(template.id),
        })),
      resourceOptions,
      assignedAttractionCount: resourceOptions.filter(
        (resource) => resource.assigned && resource.countsAsAttraction,
      ).length,
      specialRequests: requests,
      warnings,
    };
  }

  async updateBookingDetails(
    bookingId: string,
    input: BookingEditInput,
    now: Date = new Date(),
  ): Promise<Booking | null> {
    return commitmentTransaction(this.database, async (transaction) => {
      const [before] = await transaction
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1)
        .for("update");
      if (!before) return null;

      const decision=finalFollowUpDecision(before.status,input.status,input,now);
      if(decision?.kind==="schedule")await transaction.insert(followUps).values({organizationId:before.organizationId,contactId:before.primaryContactId,bookingId,kind:decision.action,dueAt:decision.dueAt});

      const openFollowUps = await transaction
        .select({
          dueAt: followUps.dueAt,
          completedAt: followUps.completedAt,
        })
        .from(followUps)
        .where(
          and(
            eq(followUps.bookingId, bookingId),
            isNull(followUps.completedAt),
          ),
        )
        .for("share");
      if (
        !bookingEditPreservesFollowUpPlan(
          input.status,
          openFollowUps,
          now,
        )
      ) {
        throw new BookingEditInvariantError();
      }

      const [updated] = await transaction
        .update(bookings)
        .set((({finalNextActionKind,finalNextActionDueAt,finalNoFurtherActionReason,...values})=>({...values,updatedAt:now}))(input))
        .where(eq(bookings.id, bookingId))
        .returning();
      if (!updated) return null;

      if(before.status!==updated.status)await transaction.insert(activities).values({organizationId:updated.organizationId,contactId:updated.primaryContactId,bookingId,kind:"note",subject:decision?.kind==="none"?`Next step: booking:${bookingId}`:"Booking status changed",status:decision?.kind==="none"?"no_further_action":null,body:`Status changed from ${before.status} to ${updated.status}. ${decision?.kind==="none"?`No further action: ${decision.reason}.`:decision?.kind==="schedule"?`Next action: ${decision.action}, due ${decision.dueAt.toISOString()}.`:"Review the next action in Today."}`,occurredAt:now,timelineSortAt:now});
      if(decision){
        const opportunityStatus=updated.status==="confirmed"?"booked":updated.status==="declined"?"declined":updated.status==="cancelled"?"cancelled":null;
        const linked=await transaction.update(bookingOpportunities).set({...(opportunityStatus?{status:opportunityStatus}:{}),nextActionKind:decision.kind==="schedule"?decision.action:null,nextActionDueAt:decision.kind==="schedule"?decision.dueAt:null,updatedAt:now}).where(eq(bookingOpportunities.bookingId,bookingId)).returning({id:bookingOpportunities.id});
        if(decision.kind==="none")for(const opportunity of linked)await transaction.insert(activities).values({organizationId:updated.organizationId,contactId:updated.primaryContactId,bookingId,kind:"note",subject:`Next step: opportunity:${opportunity.id}`,status:"no_further_action",body:`No further action: ${decision.reason}.`,occurredAt:now,timelineSortAt:now});
      }

      await recordAuditEntry(transaction, {
        entityType: "booking",
        entityId: bookingId,
        action: "update",
        before: bookingEditSnapshot(before),
        after: bookingEditSnapshot(updated),
      });

      return toBooking(updated);
    }, {source:"booking-details",bookingIds:[bookingId]});
  }
}

