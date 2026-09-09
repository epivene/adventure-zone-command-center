import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
import { eq } from "drizzle-orm";

import { db } from "@workspace/db";
import {
  actContactSyncStates,
  activities,
  bookingContacts,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { parseBusinessDateInput } from "@/lib/business-date";
import { isSafeResearchUrl } from "./profile-research-matching";
import {
  matchRelatedEventsAgainstCrm,
  type RelatedEventCrmMatch,
} from "./profile-research-related-event-matcher";
import type { RelatedEventOpportunity } from "./profile-research-discovery";

export type ResearchProspectAccepted = {
  name: string;
  city: string;
  region: string;
  startsAt: string | null;
  endsAt: string | null;
  website: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

export type ResearchProspectNextActionKind = "call" | "email" | "prepare_quote";

export type ResearchProspectScoutNoteSource = {
  url: string;
  title: string;
  publisher: string | null;
  category: string;
  retrievedAt: string;
};

export type ResearchProspectScoutNote = {
  type: "scout_note";
  version: 1;
  runId: string;
  candidateId: string;
  createdAt: string;
  originalQuestion: string;
  criteriaSummary: string | null;
  fitScore: number | null;
  summary: string;
  positives: string[];
  cautions: string[];
  coverageGaps: string[];
  suggestedNextAction: {
    kind: ResearchProspectNextActionKind;
    dueAt: string;
  };
  sources: ResearchProspectScoutNoteSource[];
};

export type ResearchProspectSaveInput = {
  event: RelatedEventOpportunity;
  accepted: ResearchProspectAccepted;
  nextActionKind: ResearchProspectNextActionKind;
  nextActionDueAt: string;
  scoutNote?: ResearchProspectScoutNote;
};

const researchProspectValidationCodes = new Set([
  "RESEARCH_PROSPECT_ACTION_REQUIRED",
  "RESEARCH_PROSPECT_FOLLOW_UP_REQUIRED",
  "RESEARCH_PROSPECT_NAME_REQUIRED",
  "RESEARCH_PROSPECT_LOCATION_REQUIRED",
  "RESEARCH_PROSPECT_PUBLIC_URL_REQUIRED",
  "RESEARCH_PROSPECT_DATE_INVALID",
  "RESEARCH_PROSPECT_DATE_RANGE_INVALID",
]);

export function isResearchProspectValidationError(error: unknown): error is Error {
  return error instanceof Error && researchProspectValidationCodes.has(error.message);
}

type CrmMatch = RelatedEventCrmMatch;

type ResearchProspectStore = {
  classify(event: RelatedEventOpportunity): Promise<CrmMatch>;
  createLead(input: {
    accepted: ResearchProspectAccepted;
    booking: {
      status: "new_lead";
      probability: "possible";
      nextActionKind: ResearchProspectNextActionKind;
      nextActionDueAt: string;
    };
    scoutNote?: ResearchProspectScoutNote;
  }): Promise<{ profileId: string; bookingId: string }>;
};

function text(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizedAccepted(input: ResearchProspectAccepted): ResearchProspectAccepted {
  return {
    name: input.name.trim(),
    city: input.city.trim(),
    region: input.region.trim().toUpperCase(),
    startsAt: text(input.startsAt),
    endsAt: text(input.endsAt),
    website: input.website.trim(),
    contactName: text(input.contactName),
    contactEmail: text(input.contactEmail),
    contactPhone: text(input.contactPhone),
  };
}

function validateAccepted(input: ResearchProspectAccepted) {
  if (!input.name) throw new Error("RESEARCH_PROSPECT_NAME_REQUIRED");
  if (!input.city || input.region.length !== 2) throw new Error("RESEARCH_PROSPECT_LOCATION_REQUIRED");
  if (!isSafeResearchUrl(input.website)) throw new Error("RESEARCH_PROSPECT_PUBLIC_URL_REQUIRED");

  const start = input.startsAt ? parseBusinessDateInput(input.startsAt) : null;
  const end = input.endsAt ? parseBusinessDateInput(input.endsAt) : null;
  if (input.startsAt && !start) throw new Error("RESEARCH_PROSPECT_DATE_INVALID");
  if (input.endsAt && !end) throw new Error("RESEARCH_PROSPECT_DATE_INVALID");
  if (start && end && end.getTime() < start.getTime()) throw new Error("RESEARCH_PROSPECT_DATE_RANGE_INVALID");
}

function splitContactName(name: string | null) {
  const parts = (name ?? "Event Contact").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Event", lastName: "Contact" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

class DrizzleResearchProspectStore implements ResearchProspectStore {
  async classify(event: RelatedEventOpportunity): Promise<CrmMatch> {
    const [classified] = await matchRelatedEventsAgainstCrm(db, [event]);
    return classified?.crmMatch ?? { status: "new_prospect" };
  }

  async createLead(input: Parameters<ResearchProspectStore["createLead"]>[0]) {
    const now = new Date();
    const startsAt = input.accepted.startsAt ? parseBusinessDateInput(input.accepted.startsAt) : null;
    const endsAt = input.accepted.endsAt ? parseBusinessDateInput(input.accepted.endsAt) : null;
    const nextDueAt = parseBusinessDateInput(input.booking.nextActionDueAt);
    if (!nextDueAt) throw new Error("RESEARCH_PROSPECT_FOLLOW_UP_REQUIRED");

    return commitmentTransaction(db, async (transaction) => {
      const [organization] = await transaction.insert(organizations).values({
        name: input.accepted.name,
        city: input.accepted.city,
        region: input.accepted.region,
        website: input.accepted.website,
        placeType: "festival_event",
        createdAt: now,
        updatedAt: now,
      }).returning({ id: organizations.id });
      if (!organization) throw new Error("RESEARCH_PROSPECT_PROFILE_CREATE_FAILED");

      const [booking] = await transaction.insert(bookings).values({
        organizationId: organization.id,
        name: input.accepted.name,
        city: input.accepted.city,
        region: input.accepted.region,
        startsAt,
        endsAt,
        status: input.booking.status,
        probability: input.booking.probability,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: bookings.id });
      if (!booking) throw new Error("RESEARCH_PROSPECT_BOOKING_CREATE_FAILED");

      let contactId: string | null = null;
      if (input.accepted.contactName || input.accepted.contactEmail || input.accepted.contactPhone) {
        const name = splitContactName(input.accepted.contactName ?? null);
        const [contact] = await transaction.insert(contacts).values({
          organizationId: null,
          firstName: name.firstName,
          lastName: name.lastName,
          email: input.accepted.contactEmail ?? null,
          phone: input.accepted.contactPhone ?? null,
          normalizedPhone: input.accepted.contactPhone
            ? normalizeNorthAmericanPhone(input.accepted.contactPhone)
            : null,
          city: input.accepted.city,
          region: input.accepted.region,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: contacts.id });
        if (!contact) throw new Error("RESEARCH_PROSPECT_CONTACT_CREATE_FAILED");
        contactId = contact.id;

        await transaction.insert(organizationContacts).values({
          organizationId: organization.id,
          contactId,
          role: "Organizer",
          isPrimary: true,
          active: true,
          source: "local",
          createdAt: now,
          updatedAt: now,
        });
        await transaction.update(contacts).set({ organizationId: organization.id, updatedAt: now }).where(eq(contacts.id, contactId));

        await transaction.insert(bookingContacts).values({
          bookingId: booking.id,
          contactId,
          role: "Organizer",
          isPrimary: true,
          source: "local",
          createdAt: now,
          updatedAt: now,
        });
        await transaction.update(bookings).set({ primaryContactId: contactId, updatedAt: now }).where(eq(bookings.id, booking.id));

        await transaction.insert(actContactSyncStates).values({
          contactId,
          localDirty: true,
          state: "waiting",
          createdAt: now,
          updatedAt: now,
        });
      }

      if (input.scoutNote) {
        await transaction.insert(activities).values({
          organizationId: organization.id,
          bookingId: booking.id,
          contactId,
          kind: "approved_suggestion",
          subject: "Scout Notes",
          body: JSON.stringify(input.scoutNote),
          occurredAt: now,
          timelineSortAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      await transaction.insert(followUps).values({
        organizationId: organization.id,
        bookingId: booking.id,
        contactId,
        kind: input.booking.nextActionKind,
        dueAt: nextDueAt,
        createdAt: now,
        updatedAt: now,
      });

      return { profileId: organization.id, bookingId: booking.id };
    });
  }
}

export class ResearchProspectIntakeService {
  constructor(private readonly store: ResearchProspectStore = new DrizzleResearchProspectStore()) {}

  async create(input: ResearchProspectSaveInput): Promise<
    | { kind: "created"; profileId: string; bookingId: string }
    | { kind: "duplicate"; match: CrmMatch }
  > {
    if (!["call", "email", "prepare_quote"].includes(input.nextActionKind)) {
      throw new Error("RESEARCH_PROSPECT_ACTION_REQUIRED");
    }
    if (!input.nextActionDueAt.trim() || !parseBusinessDateInput(input.nextActionDueAt)) {
      throw new Error("RESEARCH_PROSPECT_FOLLOW_UP_REQUIRED");
    }

    const accepted = normalizedAccepted(input.accepted);
    validateAccepted(accepted);

    const acceptedEvent: RelatedEventOpportunity = {
      name: accepted.name,
      city: accepted.city,
      region: accepted.region,
      startsAt: accepted.startsAt,
      endsAt: accepted.endsAt,
      venue: input.event.venue,
      url: accepted.website,
      rationale: "Accepted researched prospect awaiting CRM intake.",
    };

    const match = await this.store.classify(acceptedEvent);
    if (match.status !== "new_prospect") return { kind: "duplicate", match };

    const created = await this.store.createLead({
      accepted,
      booking: {
        status: "new_lead",
        probability: "possible",
        nextActionKind: input.nextActionKind,
        nextActionDueAt: input.nextActionDueAt,
      },
      scoutNote: input.scoutNote,
    });
    return { kind: "created", ...created };
  }
}