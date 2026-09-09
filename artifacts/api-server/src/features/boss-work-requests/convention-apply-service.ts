import { and, eq, ilike, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  activities,
  bossConventionSubmissions,
  bossWorkRequestEvents,
  bossWorkRequests,
  contacts,
  followUps,
  organizations,
} from "@/db/schema";
import { BossWorkRequestConflictError, BossWorkRequestNotFoundError } from "./boss-work-request-repository";

type Database = NodePgDatabase<typeof schema>;

export class ConventionApplyService {
  constructor(private readonly database: Database) {}

  async preview(submissionId: string) {
    const submission = (await this.database.select().from(bossConventionSubmissions)
      .where(eq(bossConventionSubmissions.id, submissionId)).limit(1))[0];
    if (!submission) throw new BossWorkRequestNotFoundError("Convention submission not found.");
    const payload = submission.payload;
    const [organizationMatches, contactMatches] = await Promise.all([
      payload.organizationName
        ? this.database.select({ id: organizations.id, name: organizations.name, city: organizations.city, region: organizations.region })
            .from(organizations).where(ilike(organizations.name, payload.organizationName)).limit(10)
        : Promise.resolve([]),
      payload.email
        ? this.database.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, organizationId: contacts.organizationId })
            .from(contacts).where(ilike(contacts.email, payload.email)).limit(10)
        : Promise.resolve([]),
    ]);
    return { submission, organizationMatches, contactMatches };
  }

  async apply(input: {
    requestId: string;
    submissionId: string;
    ownerId: string;
    organizationId?: string | null;
    contactId?: string | null;
    createOrganization: boolean;
    createContact: boolean;
    followUpDueAt?: Date | null;
  }) {
    return this.database.transaction(async (tx) => {
      const submission = (await tx.select().from(bossConventionSubmissions).where(and(
        eq(bossConventionSubmissions.id, input.submissionId),
        eq(bossConventionSubmissions.requestId, input.requestId),
      )).limit(1))[0];
      if (!submission) throw new BossWorkRequestNotFoundError("Convention submission not found.");
      if (submission.appliedAt) return { submission, repeated: true };

      const payload = submission.payload;
      let organizationId = input.organizationId ?? null;
      let contactId = input.contactId ?? null;

      if (input.createOrganization) {
        if (!payload.organizationName && !payload.eventName) {
          throw new BossWorkRequestConflictError("An organization or event name is required.");
        }
        organizationId = (await tx.insert(organizations).values({
          name: payload.organizationName || payload.eventName,
          city: payload.city || null,
          region: payload.state || null,
          placeType: "festival_event",
        }).returning({ id: organizations.id }))[0]!.id;
      }
      if (input.createContact) {
        if (!payload.contactName) throw new BossWorkRequestConflictError("A contact name is required.");
        const parts = payload.contactName.trim().split(/\s+/);
        contactId = (await tx.insert(contacts).values({
          organizationId,
          firstName: parts.shift() || payload.contactName,
          lastName: parts.join(" "),
          email: payload.email || null,
          phone: payload.phone || null,
        }).returning({ id: contacts.id }))[0]!.id;
      }
      if (!organizationId && !contactId) {
        throw new BossWorkRequestConflictError("Choose or create a profile before applying.");
      }

      const noteLines = [
        "Convention notes from Dave",
        `Event: ${payload.eventName}`,
        payload.packageInterest?.length ? `Package interest: ${payload.packageInterest.join(", ")}` : null,
        payload.personalDetails ? `Personal details: ${payload.personalDetails}` : null,
        payload.nextStep ? `Next step: ${payload.nextStep}` : null,
        payload.notes || null,
      ].filter(Boolean);
      await tx.insert(activities).values({
        organizationId,
        contactId,
        kind: "note",
        subject: "Convention conversation",
        status: "completed",
        body: noteLines.join("\n"),
        occurredAt: submission.createdAt,
        timelineSortAt: submission.createdAt,
      });

      let followUpId: string | null = null;
      if (input.followUpDueAt) {
        followUpId = (await tx.insert(followUps).values({
          organizationId,
          contactId,
          kind: "convention_follow_up",
          dueAt: input.followUpDueAt,
        }).returning({ id: followUps.id }))[0]!.id;
      }

      const applied = (await tx.update(bossConventionSubmissions).set({
        appliedOrganizationId: organizationId,
        appliedContactId: contactId,
        appliedFollowUpId: followUpId,
        appliedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(bossConventionSubmissions.id, input.submissionId),
        isNull(bossConventionSubmissions.appliedAt),
      )).returning())[0];
      if (!applied) throw new BossWorkRequestConflictError("These notes were applied by another request.");

      const remaining = await tx.select({ id: bossConventionSubmissions.id })
        .from(bossConventionSubmissions)
        .where(and(eq(bossConventionSubmissions.requestId, input.requestId), isNull(bossConventionSubmissions.appliedAt)))
        .limit(1);
      if (!remaining.length) {
        const request = (await tx.select().from(bossWorkRequests).where(eq(bossWorkRequests.id, input.requestId)).limit(1))[0];
        if (request && request.state !== "applied") {
          await tx.update(bossWorkRequests).set({ state: "applied", completedAt: new Date(), updatedAt: new Date() })
            .where(eq(bossWorkRequests.id, input.requestId));
          await tx.insert(bossWorkRequestEvents).values({
            requestId: input.requestId, actorKind: "owner", actorId: input.ownerId,
            priorState: request.state, newState: "applied", note: "Convention notes applied to CRM.",
          });
        }
      }
      return { submission: applied, repeated: false };
    });
  }
}
