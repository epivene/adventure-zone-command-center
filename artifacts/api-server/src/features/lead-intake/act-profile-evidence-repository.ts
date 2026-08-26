import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actSourceAssignments,
  actSourceRecords,
  actSourceRecordVersions,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import {
  extractActProfileTextEvidence,
  type ActProfileTextEvidence,
} from "./act-profile-evidence-extractor";

type DrizzleDatabase = typeof database;

export type LeadProfileEvidence = {
  organization: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    phone: string | null;
    website: string | null;
  };
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    role: string | null;
    jobTitle: string | null;
  }>;
  actText: ActProfileTextEvidence[];
  emailCandidates: Array<{
    email: string;
    sourceRecordId: string;
    sourceVersionId: string;
    sourcePath: string;
  }>;
};

export class ActProfileEvidenceRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async load(organizationId: string): Promise<LeadProfileEvidence | null> {
    const [organization] = await this.database.select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      region: organizations.region,
      phone: organizations.phone,
      website: organizations.website,
    }).from(organizations).where(and(
      eq(organizations.id, organizationId),
      isNull(organizations.consolidatedIntoId),
    )).limit(1);
    if (!organization) return null;

    const profileContacts = await this.database.select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      role: organizationContacts.role,
      jobTitle: contacts.jobTitle,
    }).from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.active, true),
      ))
      .orderBy(
        desc(organizationContacts.isPrimary),
        asc(contacts.lastName),
        asc(contacts.firstName),
        asc(contacts.id),
      );

    const assignedSources = await this.database.select({ id: actSourceRecords.id })
      .from(actSourceAssignments)
      .innerJoin(actSourceRecords, eq(actSourceRecords.id, actSourceAssignments.sourceRecordId))
      .where(and(
        eq(actSourceAssignments.targetEntityType, "organization"),
        eq(actSourceAssignments.targetEntityId, organizationId),
        isNull(actSourceAssignments.supersededAt),
        eq(actSourceRecords.streamType, "company"),
        eq(actSourceRecords.archiveCompleteness, "complete"),
      ));

    const legacySources = await this.database.select({ id: actSourceRecords.id })
      .from(actExternalLinks)
      .innerJoin(actSourceRecords, or(
        eq(actExternalLinks.sourceRecordId, actSourceRecords.id),
        and(
          isNull(actExternalLinks.sourceRecordId),
          eq(actExternalLinks.actRecordId, actSourceRecords.actRecordId),
          or(
            isNull(actExternalLinks.sourceDatabaseKey),
            eq(actExternalLinks.sourceDatabaseKey, actSourceRecords.sourceDatabaseKey),
          ),
        ),
      ))
      .where(and(
        eq(actExternalLinks.entityType, "organization"),
        eq(actExternalLinks.sourceEntityType, "company"),
        eq(actExternalLinks.entityId, organizationId),
        eq(actSourceRecords.streamType, "company"),
        eq(actSourceRecords.archiveCompleteness, "complete"),
      ));

    const sourceIds = [...new Set([...assignedSources, ...legacySources].map(({ id }) => id))].sort();
    const versions = sourceIds.length === 0 ? [] : await this.database.select({
      id: actSourceRecordVersions.id,
      sourceRecordId: actSourceRecordVersions.sourceRecordId,
      rawSnapshot: actSourceRecordVersions.rawSnapshot,
    }).from(actSourceRecordVersions)
      .where(and(
        inArray(actSourceRecordVersions.sourceRecordId, sourceIds),
        eq(actSourceRecordVersions.snapshotScope, "detail"),
      ))
      .orderBy(
        asc(actSourceRecordVersions.sourceRecordId),
        desc(actSourceRecordVersions.fetchedAt),
        desc(actSourceRecordVersions.id),
      );

    const newestBySource = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!newestBySource.has(version.sourceRecordId)) {
        newestBySource.set(version.sourceRecordId, version);
      }
    }
    const actText = [...newestBySource.values()].flatMap((version) =>
      extractActProfileTextEvidence(version.rawSnapshot, {
        sourceRecordId: version.sourceRecordId,
        sourceVersionId: version.id,
      }),
    );
    const emailCandidates = new Map<string, LeadProfileEvidence["emailCandidates"][number]>();
    for (const item of actText) {
      for (const email of item.emails) {
        if (!emailCandidates.has(email)) {
          emailCandidates.set(email, {
            email,
            sourceRecordId: item.sourceRecordId,
            sourceVersionId: item.sourceVersionId,
            sourcePath: item.sourcePath,
          });
        }
      }
    }

    return {
      organization,
      contacts: profileContacts,
      actText,
      emailCandidates: [...emailCandidates.values()],
    };
  }
}
