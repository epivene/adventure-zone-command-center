import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  businessSourceDocuments,
  businessSourceFactReviews,
} from "@/db/schema";
import type {
  BusinessSourceAccess,
  BusinessSourceFactReviewState,
} from "@workspace/db/business-source-schema";

type Database = NodePgDatabase<typeof schema>;

export type BusinessSourceSeedRecord = {
  originalFilename: string;
  displayTitle: string;
  sourceCategory: string;
  effectiveYear: number | null;
  accessScope: BusinessSourceAccess;
  storageReference?: string;
  notes: string;
};

export type BusinessSourceConflictSeedRecord = {
  sourceFilename: string;
  factKey: string;
  entityKind: string;
  entityKey: string | null;
  proposedValue: string;
  normalizedValue: string | null;
  sourceLocator: string;
  reviewState: BusinessSourceFactReviewState;
  conflictGroup: string;
};

export class BusinessSourceRepository {
  constructor(private readonly database: Database) {}

  async seedSourceDocuments(seeds: readonly BusinessSourceSeedRecord[]) {
    for (const source of seeds) {
      await this.database
        .insert(businessSourceDocuments)
        .values({
          originalFilename: source.originalFilename,
          displayTitle: source.displayTitle,
          sourceCategory: source.sourceCategory,
          effectiveYear: source.effectiveYear,
          accessScope: source.accessScope,
          reviewState: "reviewed",
          storageReference: source.storageReference ?? null,
          notes: source.notes,
          reviewedBy: "system:business-drive-review",
          reviewedAt: new Date(),
        })
        .onConflictDoNothing({ target: businessSourceDocuments.originalFilename });
    }
  }

  async seedConflictFacts(seeds: readonly BusinessSourceConflictSeedRecord[]) {
    for (const conflict of seeds) {
      const source = await this.database
        .select({ id: businessSourceDocuments.id })
        .from(businessSourceDocuments)
        .where(eq(businessSourceDocuments.originalFilename, conflict.sourceFilename))
        .limit(1);
      if (!source[0]) {
        throw new Error(`Business source was not seeded: ${conflict.sourceFilename}`);
      }

      const existing = await this.database
        .select({ id: businessSourceFactReviews.id })
        .from(businessSourceFactReviews)
        .where(
          and(
            eq(businessSourceFactReviews.sourceDocumentId, source[0].id),
            eq(businessSourceFactReviews.factKey, conflict.factKey),
            eq(businessSourceFactReviews.sourceLocator, conflict.sourceLocator),
          ),
        )
        .limit(1);
      if (existing[0]) continue;

      await this.database.insert(businessSourceFactReviews).values({
        sourceDocumentId: source[0].id,
        factKey: conflict.factKey,
        entityKind: conflict.entityKind,
        entityKey: conflict.entityKey,
        proposedValue: conflict.proposedValue,
        normalizedValue: conflict.normalizedValue,
        sourceLocator: conflict.sourceLocator,
        reviewState: conflict.reviewState,
        conflictGroup: conflict.conflictGroup,
      });
    }
  }
}
