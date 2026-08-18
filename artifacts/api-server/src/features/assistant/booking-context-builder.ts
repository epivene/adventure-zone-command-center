import type { PackageHistorySignal } from "@/features/packages/package-history";

import {
  assistantSource,
  uniqueAssistantSources,
} from "./assistant-sources";
import type {
  AssistantContextKind,
  BookingAssistantContextBundle,
} from "./assistant-types";

export type LoadedAssistantContext = {
  context: {
    kind: AssistantContextKind;
    recordId: string;
    label: string;
  };
  profile: {
    organizationId: string | null;
    eventFamilyId: string | null;
    contacts: Array<{ id: string; label: string; isPrimary: boolean }>;
  };
  currentBooking: {
    id: string;
    label: string;
    startsAt: Date | null;
    endsAt?: Date | null;
    venueName?: string | null;
    city?: string | null;
    region?: string | null;
    status: string;
    physicalAttractionTotal: number | null;
    packageNames: string[];
    specialResourceNames: string[];
  } | null;
  priorBookings: Array<{
    id: string;
    label: string;
    startsAt: Date | null;
    endsAt?: Date | null;
    venueName?: string | null;
    city?: string | null;
    region?: string | null;
    status: string;
    physicalAttractionTotal: number | null;
    packageNames: string[];
    specialResourceNames: string[];
  }>;
  recentActivities: Array<{
    id: string;
    kind: string;
    summary: string;
    occurredAt: Date | null;
  }>;
  openFollowUps: Array<{
    id: string;
    kind: string;
    dueAt: Date;
    label: string;
  }>;
  packageHistorySignals: PackageHistorySignal[];
  routeContext: { id: string; label: string; summary: string } | null;
  derivedFacts: Array<{
    id: string;
    factKind: string;
    summary: string;
    confidence: "high" | "medium" | "low";
    status: "proposed" | "confirmed" | "dismissed";
    sourceActivityIds: string[];
  }>;
  businessKnowledge: Array<{
    id: string;
    title: string;
    body: string;
  }>;
  generatedAt: Date;
};

export function buildBookingContextBundle(
  input: LoadedAssistantContext,
): BookingAssistantContextBundle {
  const sources = [];

  if (input.currentBooking) {
    sources.push(
      assistantSource({
        kind: "booking",
        recordId: input.currentBooking.id,
        label: input.currentBooking.label,
        occurredAt: input.currentBooking.startsAt,
      }),
    );
  }
  for (const booking of input.priorBookings) {
    sources.push(
      assistantSource({
        kind: "booking",
        recordId: booking.id,
        label: booking.label,
        occurredAt: booking.startsAt,
      }),
    );
  }
  for (const contact of input.profile.contacts) {
    sources.push(
      assistantSource({
        kind: "activity",
        recordId: contact.id,
        label: contact.label,
        occurredAt: null,
      }),
    );
  }
  for (const activity of input.recentActivities) {
    sources.push(
      assistantSource({
        kind: "activity",
        recordId: activity.id,
        label: activity.summary.slice(0, 120),
        occurredAt: activity.occurredAt,
      }),
    );
  }
  for (const followUp of input.openFollowUps) {
    sources.push(
      assistantSource({
        kind: "follow_up",
        recordId: followUp.id,
        label: followUp.label,
        occurredAt: followUp.dueAt,
      }),
    );
  }
  if (input.routeContext) {
    sources.push(
      assistantSource({
        kind: "route",
        recordId: input.routeContext.id,
        label: input.routeContext.label,
        occurredAt: null,
      }),
    );
  }
  for (const knowledge of input.businessKnowledge) {
    sources.push(
      assistantSource({
        kind: "business_knowledge",
        recordId: knowledge.id,
        label: knowledge.title,
        occurredAt: null,
      }),
    );
  }
  for (const fact of input.derivedFacts) {
    sources.push(
      assistantSource({
        kind: "derived_fact",
        recordId: fact.id,
        label: fact.summary.slice(0, 120),
        occurredAt: null,
      }),
    );
  }

  const uniqueSources = uniqueAssistantSources(sources);
  const sourceId = (kind: Parameters<typeof assistantSource>[0]["kind"], recordId: string) =>
    uniqueSources.find(
      (source) => source.kind === kind && source.recordId === recordId,
    )?.id;

  return {
    context: input.context,
    profile: {
      organizationId: input.profile.organizationId,
      contactIds: input.profile.contacts.map((contact) => contact.id),
      contacts: input.profile.contacts,
      eventFamilyId: input.profile.eventFamilyId,
    },
    currentBooking: input.currentBooking
      ? {
          ...input.currentBooking,
          startsAt: input.currentBooking.startsAt?.toISOString() ?? null,
          endsAt: input.currentBooking.endsAt?.toISOString() ?? null,
          venueName: input.currentBooking.venueName ?? null,
          city: input.currentBooking.city ?? null,
          region: input.currentBooking.region ?? null,
        }
      : null,
    priorBookings: input.priorBookings.map((booking) => ({
      ...booking,
      startsAt: booking.startsAt?.toISOString() ?? null,
      endsAt: booking.endsAt?.toISOString() ?? null,
      venueName: booking.venueName ?? null,
      city: booking.city ?? null,
      region: booking.region ?? null,
    })),
    recentActivities: input.recentActivities.map((activity) => ({
      id: activity.id,
      kind: activity.kind,
      summary: activity.summary,
      occurredAt: activity.occurredAt?.toISOString() ?? null,
      sourceIds: [sourceId("activity", activity.id)].filter(
        (id): id is string => Boolean(id),
      ),
    })),
    openFollowUps: input.openFollowUps.map((followUp) => ({
      id: followUp.id,
      kind: followUp.kind,
      dueAt: followUp.dueAt.toISOString(),
      label: followUp.label,
    })),
    packageHistorySignals: input.packageHistorySignals,
    routeContext: input.routeContext,
    derivedFacts: input.derivedFacts.map((fact) => ({
      id: fact.id,
      factKind: fact.factKind,
      summary: fact.summary,
      confidence: fact.confidence,
      status: fact.status,
      sourceIds: fact.sourceActivityIds.flatMap((activityId) => {
        const id = sourceId("activity", activityId);
        return id ? [id] : [];
      }),
    })),
    businessKnowledge: input.businessKnowledge.map((knowledge) => ({
      id: knowledge.id,
      title: knowledge.title,
      body: knowledge.body,
      sourceIds: [sourceId("business_knowledge", knowledge.id)].filter(
        (id): id is string => Boolean(id),
      ),
    })),
    sources: uniqueSources,
    generatedAt: input.generatedAt.toISOString(),
  };
}
