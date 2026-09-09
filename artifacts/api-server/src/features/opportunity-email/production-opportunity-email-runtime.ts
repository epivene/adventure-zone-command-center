import { createOpportunityEmailRuntime } from "./opportunity-email-runtime";
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
  const [
    drizzle,
    workspaceDb,
    schema,
    activitiesModule,
    aiModule,
    googleConnectionModule,
    relationshipModule,
    opportunitiesModule,
    aiWriterModule,
    contextResolverModule,
    googleProviderModule,
    activityModule,
    availabilityModule,
    profileModule,
    emailRepositoryModule,
    emailServiceModule,
    workflowModule,
    productionContextModule,
    readySourceModule,
    earlyBirdRepositoryModule,
    earlyBirdServiceModule,
  ] = await Promise.all([
    import("drizzle-orm"),
    import("@workspace/db"),
    import("@/db/schema"),
    import("@/features/activities/activity-repository"),
    import("@/features/ai-suggestions/ai-client"),
    import("@/features/google-workspace/google-connection-repository"),
    import("@/features/lead-intake/lead-relationship-evidence-repository"),
    import("@/features/opportunities/opportunity-repository"),
    import("./ai-opportunity-email-writer"),
    import("./draft-context-resolver"),
    import("./google-opportunity-email-provider"),
    import("./opportunity-email-activity"),
    import("./opportunity-email-availability"),
    import("./opportunity-email-profile-repository"),
    import("./opportunity-email-repository"),
    import("./opportunity-email-service"),
    import("./opportunity-email-workflow"),
    import("./production-draft-context-sources"),
    import("./production-ready-to-send-source"),
    import("@/features/early-bird-promo/early-bird-promo-repository"),
    import("@/features/early-bird-promo/early-bird-promo-service"),
  ]);

  const { and, count, eq } = drizzle;
  const { db } = workspaceDb;
  const { bookingOpportunityEmailState } = schema;
  const { DrizzleActivityRepository } = activitiesModule;
  const { createAiClient } = aiModule;
  const { PostgresGoogleConnectionRepository } = googleConnectionModule;
  const { LeadRelationshipEvidenceRepository } = relationshipModule;
  const { OpportunityRepository } = opportunitiesModule;
  const { AiOpportunityEmailWriter } = aiWriterModule;
  const { DraftContextResolver } = contextResolverModule;
  const { GoogleOpportunityEmailProvider } = googleProviderModule;
  const { OpportunityEmailActivityWriter } = activityModule;
  const { OpportunityEmailAvailability } = availabilityModule;
  const { OpportunityEmailProfileRepository } = profileModule;
  const { OpportunityEmailRepository } = emailRepositoryModule;
  const { OpportunityEmailService } = emailServiceModule;
  const { OpportunityEmailWorkflowCoordinator } = workflowModule;
  const { ProductionDraftContextSources } = productionContextModule;
  const { ProductionReadyToSendSource } = readySourceModule;
  const { EarlyBirdPromoRepository } = earlyBirdRepositoryModule;
  const { EarlyBirdPromoService } = earlyBirdServiceModule;

  const opportunities = new OpportunityRepository(db);
  const emails = new OpportunityEmailRepository(db);
  const profiles = new OpportunityEmailProfileRepository(db);
  const googleConnection = new PostgresGoogleConnectionRepository();

  const availability = new OpportunityEmailAvailability({
    bookings: { get: (id: string) => profiles.getBooking(id) },
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
      get: (organizationId: string, eventYear: number, bookingId: string | null) =>
        profiles.getProfile(organizationId, eventYear, bookingId),
    },
    recipients: {
      list: (organizationId: string, eventYear: number) =>
        profiles.listVerifiedRecipients(organizationId, eventYear),
    },
    relationships: {
      async list(input: { organizationId: string; recipientEmail: string }) {
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
      async countSent(opportunityId: string) {
        const [row] = await db
          .select({ value: count() })
          .from(bookingOpportunityEmailState)
          .where(and(
            eq(bookingOpportunityEmailState.opportunityId, opportunityId),
            eq(bookingOpportunityEmailState.state, "sent"),
          ));
        return Number(row?.value ?? 0);
      },
      async currentDraftId(opportunityId: string) {
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
    promotion: new EarlyBirdPromoService(new EarlyBirdPromoRepository(db)),
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

type ProductionOpportunityEmailRuntime = Awaited<
  ReturnType<typeof createProductionOpportunityEmailRuntime>
>;

let productionRuntimePromise: Promise<ProductionOpportunityEmailRuntime> | null = null;

export function getProductionOpportunityEmailRuntime(): Promise<ProductionOpportunityEmailRuntime> {
  productionRuntimePromise ??= createProductionOpportunityEmailRuntime().catch((error) => {
    productionRuntimePromise = null;
    throw error;
  });
  return productionRuntimePromise;
}


