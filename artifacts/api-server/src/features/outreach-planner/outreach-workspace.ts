import { randomUUID } from "node:crypto";
import { invalidateAllocationIn } from "./outreach-allocation";
import { sql } from "drizzle-orm";
import { bookingOpportunities } from "../../db/schema";
import { businessDateKey } from "../../lib/business-date";
import type { OutreachRepository } from "./outreach-repository";
import { OutreachError } from "./outreach-repository";
import { rowsOf, type QueryDatabase } from "./outreach-sources";
import { outreachContactBlock } from "./outreach-contact-safety";
import type {
  ClassificationSuggestionDTO,
  OpportunityBindingDTO,
  OpportunityBindingInput,
  ProfileAdmissionDTO,
  ProfileAdmissionInput,
  ProfileChoiceDTO,
} from "./outreach-dto";

export async function classificationSuggestions(
  db: QueryDatabase,
  organizationId: string,
): Promise<ClassificationSuggestionDTO[]> {
  const [profile] = rowsOf<{ filler: boolean; reason: string | null }>(
    await db.execute(
      sql`select coalesce((to_jsonb(g)->>'filler')::boolean,false) as filler,to_jsonb(g)->>'filler_reason' as reason from organizations g where id=${organizationId}::uuid`,
    ),
  );
  const result: ClassificationSuggestionDTO[] = profile?.filler
    ? [
        {
          tier: "filler",
          reason:
            profile.reason || "Profile has an existing filler classification.",
        },
      ]
    : [];
  const memberships = rowsOf<{ year: number }>(
    await db.execute(
      sql`select distinct e.year from convention_members m join convention_editions e on e.id=m.edition_id where m.organization_id=${organizationId}::uuid order by e.year desc`,
    ),
  );
  for (const m of memberships)
    result.push({
      tier: "convention",
      conventionYear: m.year,
      reason: `Listed in the ${m.year} convention. Verify the event year and convention end date; list outcomes are contextual history.`,
    });
  return result;
}
export async function searchProfiles(
  repo: OutreachRepository,
  search: string,
  year: number,
): Promise<ProfileChoiceDTO[]> {
  const rows = rowsOf<{
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    last_resort: boolean;
  }>(
    await repo.db.execute(
      sql`select id,name,to_jsonb(g)->>'city' as city,to_jsonb(g)->>'region' as region,last_resort from organizations g where name ilike ${`%${search}%`} and to_jsonb(g)->>'consolidated_into_id' is null order by name,id limit 50`,
    ),
  );
  return Promise.all(
    rows.map(async (p) => ({
      organizationId: p.id,
      organizationName: p.name,
      city: p.city,
      region: p.region,
      protectedReason: p.last_resort
        ? "Protected profile requires owner review."
        : await outreachContactBlock(repo.db, { organizationId: p.id }),
      suggestions: await classificationSuggestions(repo.db, p.id),
      bookings: rowsOf<{
        id: string;
        name: string;
        startsAt: string | null;
        endsAt: string | null;
      }>(
        await repo.db.execute(
          sql`select id,name,starts_at as "startsAt",ends_at as "endsAt" from bookings where organization_id=${p.id}::uuid and (starts_at is null or extract(year from starts_at at time zone 'America/Chicago')=${year}) order by starts_at nulls last,id`,
        ),
      ),
    })),
  );
}
export async function admitProfile(
  repo: OutreachRepository,
  input: ProfileAdmissionInput,
): Promise<ProfileAdmissionDTO> {
  const [profile] = rowsOf<{
    last_resort: boolean;
    consolidated: string | null;
  }>(
    await repo.db.execute(
      sql`select last_resort,to_jsonb(g)->>'consolidated_into_id' as consolidated from organizations g where id=${input.organizationId}::uuid for update`,
    ),
  );
  if (!profile || profile.consolidated)
    throw new OutreachError(
      404,
      "Select an existing active profile; this profile is missing or consolidated.",
    );
  if (profile.last_resort)
    throw new OutreachError(
      409,
      "Protected profile cannot be admitted for new outreach.",
    );
  let contactId: string | null = null;
  if (input.bookingId) {
    const [booking] = rowsOf<{
      organization_id: string;
      primary_contact_id: string | null;
      starts_at: string | null;
      ends_at: string | null;
    }>(
      await repo.db.execute(
        sql`select organization_id,primary_contact_id,starts_at,ends_at from bookings where id=${input.bookingId}::uuid for update`,
      ),
    );
    if (
      !booking ||
      booking.organization_id !== input.organizationId ||
      !booking.starts_at ||
      !booking.ends_at ||
      new Date(booking.ends_at) < new Date(booking.starts_at) ||
      +businessDateKey(new Date(booking.starts_at)).slice(0, 4) !==
        input.eventYear ||
      +businessDateKey(new Date(booking.ends_at)).slice(0, 4) !==
        input.eventYear
    )
      throw new OutreachError(
        409,
        "Identity review: select a booking owned by this profile with verified dates in the chosen event year.",
      );
    contactId = booking.primary_contact_id;
  }
  const [existing] = rowsOf<{
    id: string;
    booking_id: string | null;
    contact_id: string | null;
    status: string;
    email_automation_protected: boolean;
    territory_exception_approved: boolean;
  }>(
    await repo.db.execute(
      sql`select * from booking_opportunities where organization_id=${input.organizationId}::uuid and event_year=${input.eventYear} for update`,
    ),
  );
  if (
    existing &&
    input.bookingId !== undefined &&
    existing.booking_id !== input.bookingId
  )
    throw new OutreachError(
      409,
      "Identity review: this profile already has a different booking for that event year. Existing opportunity and manual next action were preserved.",
    );
  if (
    existing?.email_automation_protected ||
    (existing?.status === "territory_hold" &&
      !existing.territory_exception_approved)
  )
    throw new OutreachError(
      409,
      "Protected contact or territory hold cannot be admitted for new outreach.",
    );
  const blocked = await outreachContactBlock(repo.db, {
    organizationId: input.organizationId,
    contactId: existing?.contact_id ?? contactId,
  });
  if (blocked) throw new OutreachError(409, blocked);
  if (existing)
    return {
      opportunityId: existing.id,
      organizationId: input.organizationId,
      bookingId: existing.booking_id,
      eventYear: input.eventYear,
      reused: true,
      reason: input.reason,
    };
  const [created] = await repo.db
    .insert(bookingOpportunities)
    .values({
      organizationId: input.organizationId,
      eventYear: input.eventYear,
      bookingId: input.bookingId ?? null,
      contactId,
      status: "needs_review",
    })
    .returning();
  return {
    opportunityId: created.id,
    organizationId: created.organizationId,
    bookingId: created.bookingId,
    eventYear: created.eventYear,
    reused: false,
    reason: input.reason,
  };
}

export function withinResearchGeography(
  result: { latitude?: number; longitude?: number; region?: string },
  geography: {
    latitude: number;
    longitude: number;
    radiusMiles: number;
    adjacentRegions: string[];
  },
): boolean {
  if (
    result.region &&
    geography.adjacentRegions.some(
      (r) => r.toLowerCase() === result.region!.toLowerCase(),
    )
  )
    return true;
  if (result.latitude === undefined || result.longitude === undefined)
    return false;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(result.latitude - geography.latitude),
    dLon = rad(result.longitude - geography.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(geography.latitude)) *
      Math.cos(rad(result.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return (
    3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <=
    geography.radiusMiles
  );
}

export function qualifiesResearchResult(
  result: {
    checkedAt?: string;
    dateConfidence?: string;
    contactConfidence?: string;
    fitConfidence?: string;
    contact?: string;
    startsOn?: string;
    endsOn?: string;
    quantities?: Record<string, number>;
    latitude?: number;
    longitude?: number;
    region?: string;
  },
  criteria:
    import("./outreach-dto").ResearchInput["qualificationCriteria"] | null,
  now: Date,
): boolean {
  return (
    !!criteria &&
    !!result.checkedAt &&
    Number.isFinite(new Date(result.checkedAt).getTime()) &&
    new Date(result.checkedAt) <= now &&
    !!result.quantities &&
    Object.entries(criteria.quantities).every(
      ([code, q]) => (result.quantities?.[code] ?? 0) >= q,
    ) &&
    withinResearchGeography(result, criteria.geography) &&
    result.dateConfidence === "verified" &&
    result.contactConfidence === "verified" &&
    result.fitConfidence === "verified" &&
    !!result.contact &&
    !!result.startsOn &&
    !!result.endsOn &&
    result.startsOn <= result.endsOn &&
    result.startsOn >= criteria.startsOn &&
    result.endsOn <= criteria.endsOn
  );
}

/** Called only inside the shared allocation transaction, before any identity row lock. */
export async function bindOpportunityToBooking(
  repo: OutreachRepository,
  opportunityId: string,
  input: OpportunityBindingInput,
  actor: string,
): Promise<OpportunityBindingDTO> {
  // Profile first matches admission's row-lock order. Reread the opportunity after locking.
  const [identity] = rowsOf<{ organization_id: string }>(
    await repo.db.execute(
      sql`select organization_id from booking_opportunities where id=${opportunityId}::uuid`,
    ),
  );
  if (!identity) throw new OutreachError(404, "Opportunity not found.");
  const [profile] = rowsOf<{
    name: string;
    last_resort: boolean;
    consolidated: string | null;
  }>(
    await repo.db.execute(
      sql`select name,last_resort,to_jsonb(g)->>'consolidated_into_id' as consolidated from organizations g where id=${identity.organization_id}::uuid for update`,
    ),
  );
  if (!profile || profile.consolidated)
    throw new OutreachError(
      409,
      "Identity review: select an active profile; this profile is missing or consolidated.",
    );
  if (profile.last_resort)
    throw new OutreachError(
      409,
      "Protected profile cannot resolve identity for new outreach.",
    );
  const [opportunity] = rowsOf<{
    organization_id: string;
    event_year: number;
    booking_id: string | null;
    contact_id: string | null;
    status: string;
    email_automation_protected: boolean;
    territory_exception_approved: boolean;
  }>(
    await repo.db.execute(
      sql`select * from booking_opportunities where id=${opportunityId}::uuid for update`,
    ),
  );
  if (!opportunity || opportunity.organization_id !== identity.organization_id)
    throw new OutreachError(
      409,
      "Opportunity profile changed; reload and review the current identity.",
    );
  if (opportunity.event_year !== input.confirmedEventYear)
    throw new OutreachError(
      409,
      "Identity review: the confirmed event year does not match this opportunity.",
    );
  if (opportunity.booking_id && opportunity.booking_id !== input.bookingId)
    throw new OutreachError(
      409,
      "This opportunity is already linked to a different event. Open that event to review its identity; existing history was preserved.",
    );
  if (
    opportunity.email_automation_protected ||
    (opportunity.status === "territory_hold" &&
      !opportunity.territory_exception_approved)
  )
    throw new OutreachError(
      409,
      "Protected contact or territory hold must be resolved before binding event identity.",
    );
  const [booking] = rowsOf<{
    organization_id: string | null;
    primary_contact_id: string | null;
    name: string;
    starts_at: string | null;
    ends_at: string | null;
  }>(
    await repo.db.execute(
      sql`select organization_id,primary_contact_id,name,starts_at,ends_at from bookings where id=${input.bookingId}::uuid for update`,
    ),
  );
  const starts = booking?.starts_at ? new Date(booking.starts_at) : null;
  const ends = booking?.ends_at ? new Date(booking.ends_at) : null;
  if (
    !booking ||
    booking.organization_id !== opportunity.organization_id ||
    !starts ||
    !ends ||
    !Number.isFinite(starts.getTime()) ||
    !Number.isFinite(ends.getTime()) ||
    ends < starts ||
    +businessDateKey(starts).slice(0, 4) !== input.confirmedEventYear ||
    +businessDateKey(ends).slice(0, 4) !== input.confirmedEventYear
  )
    throw new OutreachError(
      409,
      "Identity review: select a verified booking on this profile with ordered actual dates in the opportunity year.",
    );
  // Preserve the opportunity's established recipient, while checking both affected contacts.
  for (const contactId of new Set([
    opportunity.contact_id,
    booking.primary_contact_id,
  ])) {
    const blocked = await outreachContactBlock(repo.db, {
      organizationId: opportunity.organization_id,
      contactId,
    });
    if (blocked) throw new OutreachError(409, blocked);
  }
  const value: OpportunityBindingDTO = {
    opportunityId,
    organizationId: opportunity.organization_id,
    bookingId: input.bookingId,
    eventYear: opportunity.event_year,
    reused: opportunity.booking_id === input.bookingId,
    reason: input.reason,
    sourceReference: input.sourceReference,
  };
  if (value.reused) return value;
  // Claim acquisition/final checks take the same mutex. Include persisted payload identity
  // and current draft associations, even when an Office payload has unknown event identity.
  const pending = rowsOf(
    await repo.db.execute(sql`
    select d.id from outreach_dispatches d where d.state in ('dispatching','uncertain') and (
      d.payload->>'opportunityId'=${opportunityId}
      or (d.payload->>'organizationId'=${opportunity.organization_id} and
        (d.payload->>'eventYear' is null or d.payload->>'eventYear'=${String(opportunity.event_year)}))
      or (d.draft_kind='opportunity_email' and exists(select 1 from booking_opportunity_email_state e where e.id=d.draft_id and e.opportunity_id=${opportunityId}::uuid))
      or (d.draft_kind='office_email' and exists(select 1 from office_email_drafts e where e.id=d.draft_id and e.organization_id=${opportunity.organization_id}::uuid and (e.event_year is null or e.event_year=${opportunity.event_year})))
    ) limit 1`),
  );
  if (pending.length)
    throw new OutreachError(
      409,
      "This profile/event has unresolved delivery. Reconcile the provider outcome before binding event identity.",
    );
  await repo.db.execute(
    sql`update booking_opportunities set booking_id=${input.bookingId}::uuid,updated_at=now() where id=${opportunityId}::uuid`,
  );
  // Opportunity digests now see the linked booking. Office drafts with null booking
  // keep their own identity, so explicitly retire all affected approvals as well.
  const invalidatedApprovals = rowsOf(
    await repo.db.execute(sql`
    delete from outreach_offer_approvals a where
      (a.draft_kind='opportunity_email' and exists(select 1 from booking_opportunity_email_state e where e.id=a.draft_id and e.opportunity_id=${opportunityId}::uuid))
      or (a.draft_kind='office_email' and exists(select 1 from office_email_drafts e where e.id=a.draft_id and e.organization_id=${opportunity.organization_id}::uuid and (e.event_year is null or e.event_year=${opportunity.event_year})))
    returning a.*`),
  );
  // Invalidate derived checks only; actual source, research, history review and manual work survive.
  await invalidateAllocationIn(repo.db);
  const profileActivityId = randomUUID();
  const detail = {
    ...value,
    invalidatedApprovals,
    confirmedSameEvent: input.confirmedSameEvent,
    actor,
    profileActivityId,
    priorIdentity: {
      opportunityId,
      organizationId: opportunity.organization_id,
      eventYear: opportunity.event_year,
      bookingId: null,
    },
    newIdentity: {
      opportunityId,
      organizationId: opportunity.organization_id,
      eventYear: opportunity.event_year,
      bookingId: input.bookingId,
    },
    bookingName: booking.name,
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
  };
  await repo.db.execute(
    sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'bind_opportunity_booking',${opportunityId}::uuid,${JSON.stringify(detail)}::jsonb)`,
  );
  const body = `Resolved ${profile.name}'s ${opportunity.event_year} opportunity from no linked event to ${booking.name} (${businessDateKey(starts)} – ${businessDateKey(ends)}). Confirmed same event by ${actor}. Reason: ${input.reason} Source: ${input.sourceReference}. Review exact demand, capacity and draft approval before outreach.`;
  await repo.db.execute(
    sql`insert into activities(id,organization_id,contact_id,booking_id,kind,subject,body,occurred_at,timeline_sort_at) values (${profileActivityId}::uuid,${opportunity.organization_id}::uuid,${opportunity.contact_id}::uuid,${input.bookingId}::uuid,'note','Outreach event identity resolved',${body},now(),now())`,
  );
  return value;
}
