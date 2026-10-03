import { createBookingDateRepairsRouter } from "./booking-date-repairs";
import { createEmailThreadAttentionRouter } from "./email-thread-attention";
import { createEmailAttentionService } from "../features/google-workspace/email-thread-attention-runtime";
import assistantWorkspaceRouter from "./assistant-workspace";
import { createOutreachPlannerRouter } from "./outreach-planner";
import { Router, type IRouter } from "express";
import { db, pool } from "@workspace/db";
import { createBookingLegOperationsRouter } from './booking-leg-operations';
import {createLegPlanningRouter} from './leg-planning';
import {LegPlanningService} from '@/features/leg-planning/planning-service';
import { createBookingLegOperationsService } from '@/features/bookings/booking-leg-operations-providers';
import { createRequireBossMiddleware } from '@/features/boss/boss-middleware';
import { DrizzleBossAccountRepository } from '@/features/boss/boss-account-repository';
import { createRequireLegManagerMiddleware } from '@/features/leg-manager/leg-manager-middleware';
import { DrizzleLegManagerRepository } from '@/features/leg-manager/leg-manager-repository';
import { createBookingWorkRouter } from "./booking-work";
import healthRouter from "./health";
import todayRouter from "./today";
import assistantRouter from "./assistant";
import assistantCommandJobsRouter from "./assistant-command-jobs";
import assistantGeneralConversationsRouter from "./assistant-general-conversations";
import assistantLeadScoutRouter from "./assistant-lead-scout";
import bookingPackageEditorRouter from "./booking-package-editor";
import bookingsRouter from "./bookings";
import contactsRouter from "./contacts";
import organizationForgivingSearchRouter from "./organization-forgiving-search";
import organizationsRouter from "./organizations";
import organizationMembershipRouter from "./organization-membership";
import calendarRouter from "./calendar";
import routesMapRouter from "./routes-map";
import tripsRouter from "./trips";
import handoffsRouter from "./handoffs";
import activitiesRouter from "./activities";
import callsRouter from "./calls";
import needsAnswerRouter from "./needs-answer";
import eventProfilesRouter from "./event-profiles";
import earlyBirdPromoRouter from "./early-bird-promo";
import eventProfileDescriptionRouter from "./event-profile-description";
import eventProfileVenueSummaryRouter from "./event-profile-venue-summary";
import profileResearchRouter from "./profile-research";
import eventDateCoverageRouter from "./event-date-coverage";
import profileResearchIntakeRouter from "./profile-research-intake";
import profileResearchSourcesRouter from "./profile-research-sources";
import profileSourceDocumentsRouter from "./profile-source-documents";
import eventFamiliesRouter from "./event-families";
import settingsRouter from "./settings";
import attendanceHistoryImportRouter from "./attendance-history-import";
import attendanceHistoryProfileRouter from "./attendance-history-profile";
import businessSourceDocumentFilesRouter from "./business-source-document-files";
import businessSourceDocumentLinksRouter from "./business-source-document-links";
import googleWorkspaceOAuthCallbackRouter from "./google-workspace-oauth-callback";
import googleWorkspaceSettingsRouter from "./google-workspace-settings";
import googleDriveBackupRouter from "./google-drive-backup";
import googleOperationalCalendarRouter from "./google-operational-calendar";
import operationalCalendarSyncHookRouter from "./operational-calendar-sync-hook";
import googleWorkspaceValidationRouter from "./google-workspace-validation";
import googleWorkspaceMatchedCorrectionsRouter from "./google-workspace-matched-corrections";
import googleWorkspaceGmailMutationsRouter from "./google-workspace-gmail-mutations";
import googleWorkspaceHistoricalBackfillRouter from "./google-workspace-historical-backfill";
import googleWorkspaceProfileEmailRouter from "./google-workspace-profile-email";
import actMigrationRouter from "./act-migration";
import actReplacementRouter from "./act-replacement";
import actRecoveryRouter from "./act-recovery";
import aiSuggestionsRouter from "./ai-suggestions";
import paperNotesRouter from "./paper-notes";
import contractsRouter from "./contracts-runtime";
import invoicesRouter from "./invoices-runtime";
import leadIntakeRouter from "./lead-intake";
import followUpsRouter from "./follow-ups";
import opportunityEmailLiveRuntimeRouter from "./opportunity-email-live-runtime";
import authRouter from "./auth";
import developmentSampleLoginsRouter from "./development-sample-logins";
import officeAuthRouter from "./office-auth";
import bossAuthRouter from "./boss-auth";
import bossDashboardRouter from "./boss-dashboard";
import bossWorkRequestsRouter from "./boss-work-requests";
import bossWorkRequestsOwnerRouter from "./boss-work-requests-owner";
import conventionOutreachRouter, { bossConventionRouter } from "./convention-outreach";
import communicationTemplatesRouter from "./communication-templates";
import bossAssignmentsRouter from "./boss-assignments";
import bossOperationsRouter from "./boss-operations";
import bossDocumentsRouter from "./boss-documents";
import bossBusinessDocumentsRouter from "./boss-business-documents";
import { mountRoleScopedInvoiceRoutes } from "./role-scoped-invoices";
import bossProfilesRouter from "./boss-profiles";
import publicWebsiteInquiriesRouter from "./public-website-inquiries";
import websiteInquiriesRouter from "./website-inquiries";
import officeTasksRouter from "./office-tasks";
import officeProfilesRouter from "./office-profiles";
import officeDocumentsRouter from "./office-documents";
import officeAttendanceHistoryRouter from "./office-attendance-history";
import officeProfileSourceDocumentsRouter from "./office-profile-source-documents";
import officeEventFamiliesRouter from "./office-event-families";
import officeMailRouter from "./office-mail";
import officeEmailDraftsRouter from "./office-email-drafts";
import officeMessagesRouter from "./office-messages";
import officeAdminAccountsRouter from "./office-admin-accounts";
import bossAdminAccountsRouter from "./boss-admin-accounts";
import officeAdminTasksRouter from "./office-admin-tasks";
import officeAdminMailRouter from "./office-admin-mail";
import officeAdminEmailDraftsRouter from "./office-admin-email-drafts";
import officeAdminMessagesRouter from "./office-admin-messages";
import officeDesignStudioRouter from "./office-design-studio";
import officeDesignStudioCanvaRouter from "./office-design-studio-canva";
import officeContractsRouter from "./office-contracts";
import officeAdminHistoryRouter from "./office-admin-history";
import managerAuthRouter from "./leg-manager-auth";
import managerMapRouter from "./leg-manager-map";
import managerRouter from "./leg-manager";
import managerRecordsRouter from "./leg-manager-records";
import managerWorkerDeleteRouter from "./leg-manager-worker-delete";
import managerReceiptExtractionRouter from "./leg-manager-receipt-extraction";
import managerEventLifecycleRouter from "./leg-manager-event-lifecycle";
import managerEventChecklistsRouter from "./leg-manager-event-checklists";
import managerEventChecklistAttachmentsRouter from "./leg-manager-event-checklist-attachments";
import managerYearEndInspectionsRouter from "./manager-year-end-inspections";
import managerTravelRouter from "./leg-manager-travel";
import managerWrapUpsRouter from "./leg-manager-wrap-ups";
import managerCommunicationsRouter from "./manager-communications";
import managerMeetupsRouter from "./manager-meetups";
import managerAssistantRouter from "./manager-assistant";
import managerAdminRouter from "./leg-manager-admin";
import managerFinanceAdminRouter from "./manager-finance-admin";
import managerWorkerDeleteAdminRouter from "./leg-manager-worker-delete-admin";
import managerEventLifecycleAdminRouter from "./leg-manager-event-lifecycle-admin";
import managerTravelAdminRouter from "./manager-travel-admin";
import eventWrapUpAdminRouter from "./event-wrap-up-admin";
import managerCommunicationsAdminRouter from "./manager-communications-admin";
import managerMeetupsAdminRouter from "./manager-meetups-admin";
import managerAssistantAdminRouter from "./manager-assistant-admin";
import adminYearEndInspectionsRouter from "./admin-year-end-inspections";
import bossYearEndInspectionsRouter from "./boss-year-end-inspections";
import { createComputerCallingRouter } from "./computer-calling";
import { createTwilioVoiceWebhooksRouter } from "./twilio-voice-webhooks";
import { createInboundComputerCallingRouter } from "./inbound-computer-calling";
import { createTwilioInboundVoiceWebhooksRouter } from "./twilio-inbound-voice-webhooks";
import { cleanupLeakedConsolidationTestFixtures } from "@/features/organizations/test-fixture-cleanup";
import { isAssistedCallingEnabled } from "@/features/calls/assisted-calling-enabled";
import { readComputerCallingConfig } from "@/features/calls/computer-calling-config";
import {
  DefaultComputerCallingService,
  DrizzleComputerCallingPhoneContextRepository,
} from "@/features/calls/computer-calling-service";
import { DrizzleComputerCallRepository } from "@/features/calls/computer-call-repository";
import { FixedWindowRateLimiter } from "@/features/calls/computer-calling-rate-limit";
import { TwilioComputerVoiceProvider } from "@/features/calls/twilio-computer-voice-provider";
import { readInboundCallingConfig } from "@/features/calls/inbound-calling-config";
import { DrizzleIncomingAvailabilityRepository } from "@/features/calls/incoming-availability-repository";
import { IncomingAvailabilityService } from "@/features/calls/incoming-availability-service";
import { DrizzleInboundCallRepository } from "@/features/calls/inbound-call-repository";
import { DrizzleInboundCallerMatcher } from "@/features/calls/inbound-caller-matcher";
import { InboundCallService } from "@/features/calls/inbound-call-service";
import { InboundVoicemailService } from "@/features/calls/inbound-voicemail-service";
import { requireOwnerMiddleware } from "../lib/auth";
import marketingRouter from "./marketing";
import coiCertificatesRouter from "./coi-certificates";
import businessDocumentsRouter from "./business-documents";
import businessDocumentImportsRouter from "./business-document-imports";

const router: IRouter = Router();
let leakedFixtureCleanup: Promise<void> | null = null;

const computerCallingConfig = () => readComputerCallingConfig(process.env);
const computerCallingAvailable = () => {
  const result = computerCallingConfig();
  return isAssistedCallingEnabled() && result.enabled
    ? { enabled: true as const, callerId: result.config.verifiedCallerId }
    : { enabled: false as const };
};
const computerCallingService = new DefaultComputerCallingService(
  new DrizzleComputerCallRepository(db),
  new DrizzleComputerCallingPhoneContextRepository(db),
  computerCallingAvailable,
);
const computerCallingProvider = (config: Extract<ReturnType<typeof computerCallingConfig>, { enabled: true }> ["config"]) =>
  new TwilioComputerVoiceProvider(config);
const computerCallingLimiter = new FixedWindowRateLimiter({
  limit: 10,
  windowMs: 5 * 60 * 1_000,
});
const inboundAvailabilityService = new IncomingAvailabilityService(
  new DrizzleIncomingAvailabilityRepository(db),
);
const inboundCallService = new InboundCallService(new DrizzleInboundCallRepository(db), new DrizzleInboundCallerMatcher(db));
const inboundVoicemailService = new InboundVoicemailService(db, () => {
  const config = readInboundCallingConfig(process.env);
  if (!config.enabled) throw new Error("Inbound voice provider unavailable");
  return new TwilioComputerVoiceProvider(config.config.voiceConfig);
});

router.use(healthRouter);
router.use(authRouter);
router.use(developmentSampleLoginsRouter);
router.use(googleWorkspaceOAuthCallbackRouter);
router.use(officeAuthRouter);
router.use(bossAuthRouter);
router.use(publicWebsiteInquiriesRouter);
router.use(websiteInquiriesRouter);
router.use(officeTasksRouter);
router.use(bossDashboardRouter);
router.use(bossWorkRequestsRouter);
router.use(bossConventionRouter);
router.use(bossAssignmentsRouter);
router.use(bossOperationsRouter);
router.use(bossYearEndInspectionsRouter);
router.use(bossDocumentsRouter);
router.use(bossBusinessDocumentsRouter);
router.use(bossProfilesRouter);
router.use(createBookingLegOperationsRouter({
  service: createBookingLegOperationsService(pool, db),
  requireOwner: requireOwnerMiddleware,
  requireBoss: createRequireBossMiddleware(new DrizzleBossAccountRepository(db)),
  requireManager: createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db)),
}));
router.use(createLegPlanningRouter({service:new LegPlanningService(db),requireOwner:requireOwnerMiddleware,requireBoss:createRequireBossMiddleware(new DrizzleBossAccountRepository(db)),requireManager:createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db))}));
router.use(coiCertificatesRouter);
router.use(officeProfilesRouter);
router.use(officeDocumentsRouter);
router.use(officeAttendanceHistoryRouter);
router.use(officeProfileSourceDocumentsRouter);
router.use(officeEventFamiliesRouter);
router.use(officeMailRouter);
router.use(officeEmailDraftsRouter);
router.use(officeMessagesRouter);
router.use(officeContractsRouter);
// Design Studio accepts either an Office session or an owner session and
// enforces that boundary internally. Mount it before the owner-only gate so
// Office coordinators can load projects, templates, assets, and editor tools.
router.use(officeDesignStudioRouter);
router.use(officeDesignStudioCanvaRouter);
router.use(managerAuthRouter);
router.use(managerMapRouter);
router.use(managerRouter);
router.use(managerRecordsRouter);
router.use(managerWorkerDeleteRouter);
router.use(managerReceiptExtractionRouter);
router.use(managerEventLifecycleRouter);
router.use(managerEventChecklistsRouter);
router.use(managerEventChecklistAttachmentsRouter);
router.use(managerYearEndInspectionsRouter);
router.use(managerTravelRouter);
router.use(managerWrapUpsRouter);
router.use(managerCommunicationsRouter);
router.use(managerMeetupsRouter);
router.use(managerAssistantRouter);
router.use(createTwilioVoiceWebhooksRouter({
  service: computerCallingService,
  providerForConfig: computerCallingProvider,
  getConfig: computerCallingConfig,
  isAssistedCallingEnabled: isAssistedCallingEnabled,
}));
router.use(createTwilioInboundVoiceWebhooksRouter({
  getInboundConfig: () => readInboundCallingConfig(process.env),
  isAssistedCallingEnabled,
  providerForConfig: computerCallingProvider,
  availability: inboundAvailabilityService,
  calls: inboundCallService,
  voicemails: inboundVoicemailService,
}));

mountRoleScopedInvoiceRoutes(router, requireOwnerMiddleware);
router.use("/outreach-planner", createOutreachPlannerRouter());
router.use(conventionOutreachRouter);
router.use(async (req, _res, next) => {
  leakedFixtureCleanup ??= cleanupLeakedConsolidationTestFixtures(db);
  try {
    await leakedFixtureCleanup;
  } catch (err) {
    leakedFixtureCleanup = null;
    req.log.error({ err }, "Failed to clean leaked consolidation test fixtures");
  }
  next();
});
router.use(bossWorkRequestsOwnerRouter);
router.use(communicationTemplatesRouter);
router.use(officeAdminAccountsRouter);
router.use(marketingRouter);
router.use(bossAdminAccountsRouter);
router.use(officeAdminTasksRouter);
router.use("/email-thread-attention", createEmailThreadAttentionRouter(createEmailAttentionService(pool)));
router.use("/booking-work", createBookingWorkRouter(pool));
router.use(officeAdminMailRouter);
router.use(officeAdminEmailDraftsRouter);
router.use(officeAdminMessagesRouter);
router.use(officeAdminHistoryRouter);
router.use(managerAdminRouter);
router.use(managerFinanceAdminRouter);
router.use(managerWorkerDeleteAdminRouter);
router.use(managerEventLifecycleAdminRouter);
router.use(managerTravelAdminRouter);
router.use(eventWrapUpAdminRouter);
router.use(managerCommunicationsAdminRouter);
router.use(managerMeetupsAdminRouter);
router.use(managerAssistantAdminRouter);
router.use(adminYearEndInspectionsRouter);
router.use(leadIntakeRouter);
router.use(attendanceHistoryImportRouter);
router.use(attendanceHistoryProfileRouter);
router.use(businessSourceDocumentFilesRouter);
router.use(businessSourceDocumentLinksRouter);
router.use(businessDocumentsRouter);
router.use(businessDocumentImportsRouter);
router.use(profileSourceDocumentsRouter);
router.use(todayRouter);
router.use(opportunityEmailLiveRuntimeRouter);
router.use(assistantCommandJobsRouter);
router.use(assistantGeneralConversationsRouter);
router.use("/assistant/workspace",assistantWorkspaceRouter);
router.use(assistantRouter);
router.use(assistantLeadScoutRouter);
router.use(bookingPackageEditorRouter);
router.use(operationalCalendarSyncHookRouter);
router.use(bookingsRouter);
router.use(contactsRouter);
router.use(organizationMembershipRouter);
router.use(organizationForgivingSearchRouter);
router.use(organizationsRouter);
router.use(calendarRouter);
router.use(routesMapRouter);
router.use(tripsRouter);
router.use(handoffsRouter);
router.use(activitiesRouter);
router.use(callsRouter);
router.use(createComputerCallingRouter({
  service: computerCallingService,
  providerForConfig: computerCallingProvider,
  getConfig: computerCallingConfig,
  isAssistedCallingEnabled: isAssistedCallingEnabled,
  limiter: computerCallingLimiter,
}));
router.use(createInboundComputerCallingRouter({
  service: inboundAvailabilityService,
  getConfig: () => readInboundCallingConfig(process.env),
  isAssistedCallingEnabled,
  providerForConfig: () => {
    const config = readInboundCallingConfig(process.env);
    if (!config.enabled) throw new Error("Inbound voice provider unavailable");
    return new TwilioComputerVoiceProvider(config.config.voiceConfig);
  },
  calls: inboundCallService,
  voicemails: inboundVoicemailService,
}));
router.use(needsAnswerRouter);
router.use(eventProfilesRouter);
router.use(earlyBirdPromoRouter);
router.use(eventProfileDescriptionRouter);
router.use(eventProfileVenueSummaryRouter);
router.use(profileResearchRouter);
router.use(createBookingDateRepairsRouter());
router.use(eventDateCoverageRouter);
router.use(profileResearchIntakeRouter);
router.use(profileResearchSourcesRouter);
router.use(eventFamiliesRouter);
router.use(settingsRouter);
router.use(googleWorkspaceSettingsRouter);
router.use(googleDriveBackupRouter);
router.use(googleOperationalCalendarRouter);
router.use(googleWorkspaceValidationRouter);
router.use(googleWorkspaceMatchedCorrectionsRouter);
router.use(googleWorkspaceGmailMutationsRouter);
router.use(googleWorkspaceHistoricalBackfillRouter);
router.use(googleWorkspaceProfileEmailRouter);
router.use(actRecoveryRouter);
router.use(actReplacementRouter);
router.use(actMigrationRouter);
router.use(aiSuggestionsRouter);
router.use(paperNotesRouter);
router.use(contractsRouter);
router.use(invoicesRouter);
router.use("/follow-ups", followUpsRouter);

export default router;
