import { db } from "@workspace/db";
import { bookings, followUps, organizations } from "@/db/schema";
import { parseBusinessDateInput } from "@/lib/business-date";
import { isSafeResearchUrl } from "./profile-research-matching";
import { matchRelatedEventsAgainstCrm } from "./profile-research-related-event-matcher";
import type { RelatedEventOpportunity } from "./profile-research-discovery";

export type BulkProspectEvent = RelatedEventOpportunity;

export type BulkProspectCreateInput = {
  events: BulkProspectEvent[];
  nextActionKind: string;
  nextActionDueAt: string;
};

type CrmMatch =
  | { status: "existing"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "possible_match"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "new_prospect" };

type BulkProspectStore = {
  classify(event: BulkProspectEvent): Promise<CrmMatch>;
  createLead(input: {
    event: BulkProspectEvent & { website: string };
    booking: {
      status: "new_lead";
      probability: "possible";
      nextActionKind: string;
      nextActionDueAt: string;
    };
  }): Promise<{ profileId: string; bookingId: string }>;
};

class DrizzleBulkProspectStore implements BulkProspectStore {
  async classify(event: BulkProspectEvent): Promise<CrmMatch> {
    const [classified] = await matchRelatedEventsAgainstCrm(db, [event]);
    return classified?.crmMatch ?? { status: "new_prospect" };
  }

  async createLead(input: Parameters<BulkProspectStore["createLead"]>[0]) {
    const now = new Date();
    const startsAt = input.event.startsAt ? parseBusinessDateInput(input.event.startsAt) : null;
    const endsAt = input.event.endsAt ? parseBusinessDateInput(input.event.endsAt) : null;
    const nextDueAt = parseBusinessDateInput(input.booking.nextActionDueAt);
    if (!nextDueAt) throw new Error("INVALID_BULK_FOLLOW_UP_DATE");

    return db.transaction(async (transaction) => {
      const [organization] = await transaction.insert(organizations).values({
        name: input.event.name.trim(),
        city: input.event.city?.trim() || null,
        region: input.event.region?.trim().toUpperCase() || null,
        website: input.event.website,
        placeType: "festival_event",
        createdAt: now,
        updatedAt: now,
      }).returning({ id: organizations.id });
      if (!organization) throw new Error("BULK_PROFILE_CREATE_FAILED");

      const [booking] = await transaction.insert(bookings).values({
        organizationId: organization.id,
        name: input.event.name.trim(),
        city: input.event.city!.trim(),
        region: input.event.region!.trim().toUpperCase(),
        startsAt,
        endsAt,
        status: "new_lead",
        probability: "possible",
        createdAt: now,
        updatedAt: now,
      }).returning({ id: bookings.id });
      if (!booking) throw new Error("BULK_BOOKING_CREATE_FAILED");

      await transaction.insert(followUps).values({
        organizationId: organization.id,
        bookingId: booking.id,
        kind: input.booking.nextActionKind.trim() || "call",
        dueAt: nextDueAt,
        createdAt: now,
        updatedAt: now,
      });

      return { profileId: organization.id, bookingId: booking.id };
    });
  }
}

export class ProfileResearchBulkIntakeService {
  constructor(private readonly store: BulkProspectStore = new DrizzleBulkProspectStore()) {}

  async create(input: BulkProspectCreateInput) {
    if (!input.events.length) throw new Error("BULK_PROSPECT_EMPTY");
    if (input.events.length > 20) throw new Error("BULK_PROSPECT_LIMIT");
    if (!input.nextActionKind.trim()) throw new Error("BULK_PROSPECT_ACTION_REQUIRED");
    if (!parseBusinessDateInput(input.nextActionDueAt)) throw new Error("INVALID_BULK_FOLLOW_UP_DATE");

    const created: Array<{ name: string; profileId: string; bookingId: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const event of input.events) {
      const name = event.name.trim();
      if (!name || !event.city?.trim() || !event.region?.trim() || event.region.trim().length !== 2 || !isSafeResearchUrl(event.url)) {
        skipped.push({ name: name || "Unnamed event", reason: "missing_required_info" });
        continue;
      }
      const match = await this.store.classify(event);
      if (match.status !== "new_prospect") {
        skipped.push({ name, reason: match.status });
        continue;
      }
      const result = await this.store.createLead({
        event: { ...event, website: event.url },
        booking: {
          status: "new_lead",
          probability: "possible",
          nextActionKind: input.nextActionKind.trim(),
          nextActionDueAt: input.nextActionDueAt,
        },
      });
      created.push({ name, ...result });
    }

    return { created, skipped };
  }
}
