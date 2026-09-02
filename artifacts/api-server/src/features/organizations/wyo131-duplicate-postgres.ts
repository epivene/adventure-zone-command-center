import { sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { OrganizationConflictError } from "./organization-conflict";
import { prepareOrganizationMergeReferences } from "./organization-merge-reference-preparation";
import { DrizzleOrganizationRepository } from "./organization-repository";
import { prepareSelectedProfileSubsetMerge } from "./profile-subset-merge-guard";
import {
  type WYO131_DUPLICATE_GROUP,
  type Wyo131DuplicateMergeOutcome,
  type Wyo131DuplicateRepository,
} from "./wyo131-duplicate-cleanup";

type Wyo131DuplicateGroup = typeof WYO131_DUPLICATE_GROUP;

type ProfileRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  website: string | null;
  contactCount: number | string;
  bookingCount: number | string;
};

function normalizedHost(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    ).hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
  } catch {
    return null;
  }
}

function profileMatches(
  profile: ProfileRow,
  expectedName: string,
  group: Wyo131DuplicateGroup,
): boolean {
  return profile.name === expectedName
    && profile.city?.trim() === group.city
    && profile.region?.trim().toLocaleUpperCase("en-US") === group.region
    && normalizedHost(profile.website) === group.websiteHost;
}

export class PostgresWyo131DuplicateRepository
implements Wyo131DuplicateRepository {
  private readonly organizationRepository = new DrizzleOrganizationRepository(db);

  async mergeExactGroup(
    group: Wyo131DuplicateGroup,
  ): Promise<Wyo131DuplicateMergeOutcome> {
    try {
      return await db.transaction(async (transaction) => {
        const result = await transaction.execute<ProfileRow>(sql`
          SELECT
            o.id::text AS id,
            o.name,
            o.city,
            o.region,
            o.website,
            (
              SELECT count(*)::int
              FROM organization_contacts oc
              WHERE oc.organization_id = o.id
                AND oc.active = true
            ) AS "contactCount",
            (
              SELECT count(*)::int
              FROM bookings b
              WHERE b.organization_id = o.id
            ) AS "bookingCount"
          FROM organizations o
          WHERE o.consolidated_into_id IS NULL
            AND o.name IN (${group.survivorName}, ${group.duplicateName})
          ORDER BY o.id
          FOR UPDATE
        `);

        const survivors = result.rows.filter(
          (profile) => profile.name === group.survivorName,
        );
        const duplicates = result.rows.filter(
          (profile) => profile.name === group.duplicateName,
        );
        if (survivors.length !== 1) return "unsafe";

        const survivor = survivors[0]!;
        if (!profileMatches(survivor, group.survivorName, group)) {
          return "unsafe";
        }
        if (duplicates.length === 0) return "already_merged";
        if (duplicates.length !== 1) return "unsafe";

        const duplicate = duplicates[0]!;
        if (!profileMatches(duplicate, group.duplicateName, group)) {
          return "unsafe";
        }

        // The screenshot-reviewed survivor is the record that already owns the
        // real contact and booking. Refuse to choose it if that evidence changed.
        if (
          Number(survivor.contactCount) < 1
          || Number(survivor.bookingCount) < 1
        ) {
          return "unsafe";
        }

        const selectedIds = [survivor.id, duplicate.id];
        await prepareSelectedProfileSubsetMerge(transaction, selectedIds);
        await prepareOrganizationMergeReferences(
          transaction,
          survivor.id,
          [duplicate.id],
        );
        await this.organizationRepository.mergeOrganizations(
          survivor.id,
          [duplicate.id],
          transaction,
        );
        return "merged";
      });
    } catch (error) {
      if (error instanceof OrganizationConflictError) return "unsafe";
      throw error;
    }
  }
}
