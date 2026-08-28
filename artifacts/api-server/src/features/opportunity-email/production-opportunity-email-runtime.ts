import { and, count, eq } from "drizzle-orm";
import { db } from "@workspace/db";

import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { createAiClient } from "@/features/ai-suggestions/ai-client";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { LeadRelationshipEvidenceRepository } from "@/features/lead-intake/lead-relationship-evidence-repository";
import { OpportunityRepository } from "@/features/opportunities/opportunity-repository";
import { bookingOpportunityEmailState } from "@/db/schema";
import { AiOpportunityEmailWriter } from "./ai-opportunity-email-writer";
import { DraftContextResolver } from "./draft-context-resolver";
import { GoogleOpportunityEmailProvider } from "./google-opportunity-email-provider";
import { OpportunityEmailActivityWriter } from "./opportunity-email-activity";
import { OpportunityEmailAvailability } from "./opportunity-email-availability";
import { OpportunityEmailProfileRepository } from "./opportunity-email-profile-repository";
import { OpportunityEmailRepository } from "./opportunity-email-repository";
import { createOpportunityEmailRuntime } from "./opportunity-email-runtime";
import { OpportunityEmailService } from "./opportunity-email-service";
import { OpportunityEmailWorkflowCoordinator } from "./opportunity-email-workflow";
import { ProductionDraftContextSources } from "./production-draft-context-sources";
import { ProductionReadyToSendSource } from "./production-ready-to-send-source";
import type { ReadyToSendSource } from "./ready-to-send-service";

type SharedRuntimeDependencies = Parameters<typeof createOpportunityEmailRuntime>[0];

export function assembleProductionOpportunityEmailRuntime(input: {
  emailService: SharedRuntimeDependencies["emailService"];
  repository: SharedRuntimeDependencies["repository"];
  readySource: ReadyToSendSource;
}) {
  return createOpportunityEmailRuntime(input);
}

export async function createProductionOpportunityEmailRuntime() {
  const opportunities = new OpportunityRepository(db);
  const emails = new OpportunityEmailRepository(db);
  const profiles = new OpportunityEmailProfileRepository(db);
  const googleConnection = new PostgresGoogleConnectionRepository();

  const availability = new OpportunityEmailAvailability({
    bookings: { get: (id) => profiles.getBooking(id) },
    calendars: { selected: () => profiles.selectedCalendars() },
    packages: { active: () => profiles.activePackages() },
    google: {
      async readClient() {
        try {
          return await googleConnection.createReadClient();
        } catch {
          return null;
        }
      },
    },
  });

  const contextSources = new ProductionDraftContextSources({
    opportunities,
    profiles: {
      get: (organizationId, eventYear, bookingId) =>
        profiles.getProfile(organizationId, eventYear, bookingId),
    },
    recipients: {
      list: (organizationId, eventYear) =>
        profiles.listVerifiedRecipients(organizationId, eventYear),
    },
    relationships: {
      async list(input) {
        let google;
        try {
          google = await googleConnection.createReadClient();
        } catch {
          google = null;
        }
        return new LeadRelationshipEvidenceRepository(
          db,
          google ?? undefined,
        ).list(input);
      },
    },
    emailState: {
      async countSent(opportunityId) {
        const [row] = await db
          .select({ value: count() })
          .from(bookingOpportunityEmailState)
          .where(and(
            eq(bookingOpportunityEmailState.opportunityId, opportunityId),
            eq(bookingOpportunityEmailState.state, "sent"),
          ));
        return Number(row?.value ?? 0);
      },
      async currentDraftId(opportunityId) {
        return (await emails.getCurrentForOpportunity(opportunityId))?.id ?? null;
      },
    },
    availability,
  });

  const contextResolver = new DraftContextResolver(contextSources);
  const ai = await createAiClient();
  const writer = new AiOpportunityEmailWriter(ai);
  const gmail = new GoogleOpportunityEmailProvider(googleConnection);
  const activity = new OpportunityEmailActivityWriter({
    opportunities,
    activities: new DrizzleActivityRepository(db),
  });
  const workflow = new OpportunityEmailWorkflowCoordinator({
    opportunities,
    activity,
  });
  const emailService = new OpportunityEmailService({
    contextResolver,
    emailRepository: emails,
    draftGenerator: writer,
    gmailDraftProvider: gmail,
    blockerSink: workflow,
    rewriteAdapter: writer,
    workflowSink: workflow,
  });
  const readySource = new ProductionReadyToSendSource({
    emails,
    opportunities,
    profiles,
  });

  return assembleProductionOpportunityEmailRuntime({
    emailService,
    repository: emails,
    readySource,
  });
}
