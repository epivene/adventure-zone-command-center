import { and, eq, inArray, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookings,
  businessSourceDocumentFiles,
  businessSourceDocumentLinks,
  businessSourceDocuments,
  businessSourceHistoricalTerms,
  organizationLocations,
} from "@/db/schema";

export type ProfileSourceDocumentView = {
  id: string;
  title: string;
  category: string;
  effectiveYear: number | null;
  hasFile: boolean;
  canOpenFile: boolean;
  historicalTerms: Array<{
    label: string;
    value: string;
    sourceLocator: string;
  }>;
};

type Database = typeof database;

export async function listProfileSourceDocuments(
  database: Database,
  organizationId: string,
  scope: "owner" | "office",
): Promise<ProfileSourceDocumentView[]> {
  const [locations, organizationBookings] = await Promise.all([
    database
      .select({ id: organizationLocations.id })
      .from(organizationLocations)
      .where(eq(organizationLocations.organizationId, organizationId)),
    database
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.organizationId, organizationId)),
  ]);

  const locationIds = locations.map((row) => row.id);
  const bookingIds = organizationBookings.map((row) => row.id);
  const linkConditions = [eq(businessSourceDocumentLinks.organizationId, organizationId)];
  if (locationIds.length) {
    linkConditions.push(inArray(businessSourceDocumentLinks.organizationLocationId, locationIds));
  }
  if (bookingIds.length) {
    linkConditions.push(inArray(businessSourceDocumentLinks.bookingId, bookingIds));
  }

  const links = await database
    .select()
    .from(businessSourceDocumentLinks)
    .where(linkConditions.length === 1 ? linkConditions[0]! : or(...linkConditions)!);
  if (!links.length) return [];

  const documentIds = [...new Set(links.map((link) => link.sourceDocumentId))];
  const documents = scope === "office"
    ? await database
        .select()
        .from(businessSourceDocuments)
        .where(and(
          inArray(businessSourceDocuments.id, documentIds),
          eq(businessSourceDocuments.accessScope, "office"),
        ))
    : await database
        .select()
        .from(businessSourceDocuments)
        .where(inArray(businessSourceDocuments.id, documentIds));
  if (!documents.length) return [];

  const allowedIds = new Set(documents.map((document) => document.id));
  const allowedLinks = links.filter((link) => allowedIds.has(link.sourceDocumentId));
  const allowedLinkIds = allowedLinks.map((link) => link.id);
  const allowedDocumentIds = documents.map((document) => document.id);

  const [files, terms] = await Promise.all([
    database
      .select({
        id: businessSourceDocumentFiles.id,
        sourceDocumentId: businessSourceDocumentFiles.sourceDocumentId,
      })
      .from(businessSourceDocumentFiles)
      .where(inArray(businessSourceDocumentFiles.sourceDocumentId, allowedDocumentIds)),
    allowedLinkIds.length
      ? database
          .select({
            sourceDocumentId: businessSourceHistoricalTerms.sourceDocumentId,
            documentLinkId: businessSourceHistoricalTerms.documentLinkId,
            label: businessSourceHistoricalTerms.label,
            valueText: businessSourceHistoricalTerms.valueText,
            sourceLocator: businessSourceHistoricalTerms.sourceLocator,
          })
          .from(businessSourceHistoricalTerms)
          .where(and(
            inArray(businessSourceHistoricalTerms.sourceDocumentId, allowedDocumentIds),
            inArray(businessSourceHistoricalTerms.documentLinkId, allowedLinkIds),
            eq(businessSourceHistoricalTerms.reviewState, "approved"),
          ))
      : Promise.resolve([]),
  ]);

  const fileIds = new Set(files.map((file) => file.sourceDocumentId));
  const termsByDocument = new Map<string, ProfileSourceDocumentView["historicalTerms"]>();
  for (const term of terms) {
    const list = termsByDocument.get(term.sourceDocumentId) ?? [];
    list.push({
      label: term.label,
      value: term.valueText,
      sourceLocator: term.sourceLocator,
    });
    termsByDocument.set(term.sourceDocumentId, list);
  }

  return documents.map((document) => ({
    id: document.id,
    title: document.displayTitle,
    category: document.sourceCategory,
    effectiveYear: document.effectiveYear,
    hasFile: fileIds.has(document.id),
    canOpenFile: scope === "owner" && fileIds.has(document.id),
    historicalTerms: termsByDocument.get(document.id) ?? [],
  }));
}
