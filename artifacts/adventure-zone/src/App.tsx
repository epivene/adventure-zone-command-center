import { WorkspaceSessionProvider } from "@/features/assistant-workspace/WorkspaceSessionProvider";
import AssistantOfflinePage from "@/pages/AssistantOfflinePage";
import { ManagerAuthProvider, useManagerAuth } from "@/lib/manager-auth-context";
import { MANAGER_PROTECTED_PATH } from "@/lib/manager-route-pattern";
import { ADMIN_AFTERMATH_PATH, ADMIN_WRAP_UP_PATH } from "@/lib/admin-aftermath-route";
import { BossAuthProvider, useBossAuth } from "@/lib/boss-auth-context";
import { BOSS_PROTECTED_PATH } from "@/lib/boss-route-pattern";
import { lazy, Suspense, useState, type ComponentType, type FormEvent, type LazyExoticComponent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Route, Switch, Router as WouterRouter, Redirect, useLocation, useSearch } from "wouter";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { OfflineBanner } from "@/components/connectivity/offline-banner";
import { Toaster } from "@workspace/avz-crm/components/ui/toaster";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { AssistantContextProvider } from "@/features/assistant/assistant-context";
import {
  canonicalActMigrationPath,
  canonicalCallLogPath,
  canonicalCallsPath,
  canonicalProfilePath,
  canonicalProfilesPath,
  canonicalSchedulePath,
} from "@/lib/canonical-routes";

import { OfficeAuthProvider, useOfficeAuth } from "@/lib/office-auth-context";
import { OFFICE_PROTECTED_PATH } from "@/lib/office-route-pattern";
import { CommandTerminalLanding } from "@/components/command-terminal/command-terminal-landing";

const SettingsChatGPTConnectionPage = lazy(() => import("@/pages/SettingsChatGPTConnectionPage"));
const ChatGPTConnectionConsentPage = lazy(() => import("@/pages/ChatGPTConnectionConsentPage"));
const ManagerIssuesAdminPage = lazy(() => import("@/pages/ManagerIssuesAdminPage"));
const ManagerRoutePage = lazy(() => import("@/pages/ManagerRoutePage"));
const ManagerMoneyPage = lazy(() => import("@/pages/ManagerMoneyPage"));
const ManagerReceiptsPage = lazy(() => import("@/pages/ManagerReceiptsPage"));
const ManagerOperationsPage = lazy(() => import("@/pages/ManagerOperationsPage"));
const ManagerYearEndInspectionPage = lazy(() => import("@/pages/ManagerYearEndInspectionPage"));
const ManagerFinanceAdminPage = lazy(() => import("@/pages/ManagerFinanceAdminPage"));
const ManagerCommunicationsAdminPage = lazy(() => import("@/pages/ManagerCommunicationsAdminPage"));
const ManagerCrewAdminPage = lazy(() => import("@/pages/ManagerCrewAdminPage"));
const ManagerAftermathAdminPage = lazy(() => import("@/pages/ManagerAftermathAdminPage"));
const EventWrapUpAdminPage = lazy(() => import("@/pages/EventWrapUpAdminPage"));
const ManagerIncidentPage = lazy(() => import("@/pages/ManagerIncidentPage"));
const ManagerIncidentsPage = lazy(() => import("@/pages/ManagerIncidentsPage"));
const ManagerCrewPage = lazy(() => import("@/pages/ManagerCrewPage"));
const ManagerWorkerPage = lazy(() => import("@/pages/ManagerWorkerPage"));
const ManagerEventReviewPage = lazy(() => import("@/pages/ManagerEventReviewPage"));
const ManagerEventWrapUpPage = lazy(() => import("@/pages/ManagerEventWrapUpPage"));
const ManagerEventChecklistPage = lazy(() => import("@/pages/ManagerEventChecklistPage"));
const ManagerHomePage = lazy(() => import("@/pages/ManagerHomePage"));
const ManagerMessagesPage = lazy(() => import("@/pages/ManagerMessagesPage"));
const ManagerSignInPage = lazy(() => import("@/pages/ManagerSignInPage"));
const ManagerShell = lazy(() => import("@/components/manager/manager-shell").then(({ ManagerShell }) => ({ default: ManagerShell })));
const AppShell = lazy(() => import("@/components/navigation/app-shell").then(({ AppShell }) => ({ default: AppShell })));

const AdminCommandPanelPage = lazy(() => import("@/pages/AdminCommandPanelPage"));
const MarketingHomePage = lazy(() => import("@/pages/MarketingHomePage"));
const DesignStudioPage = lazy(() => import("@/pages/DesignStudioPage"));
const DesignStudioEditorPage = lazy(() => import("@/pages/DesignStudioEditorPage"));
const TodayPage = lazy(() => import("@/pages/TodayPage"));
const BookingsPage = lazy(() => import("@/pages/BookingsPage"));
const BookingDetailPage = lazy(() => import("@/pages/BookingDetailPage"));
const BookingEditPage = lazy(() => import("@/pages/BookingEditPage"));
const ContractBuilderPage = lazy(() => import("@/pages/ContractBuilderPage"));
const ContractHandoffPage = lazy(() => import("@/pages/ContractHandoffPage"));
const ContactsPage = lazy(() => import("@/pages/ContactsPage"));
const ContactDetailPage = lazy(() => import("@/pages/ContactDetailPage"));
const ContactEditPage = lazy(() => import("@/pages/ContactEditPage"));
const ContactNewPage = lazy(() => import("@/pages/ContactNewPage"));
const OrganizationsPage = lazy(() => import("@/pages/OrganizationsPage"));
const EventFamilyPage = lazy(() => import("@/pages/EventFamilyPage"));
const SchedulePage = lazy(() => import("@/pages/SchedulePage"));
const LegManagementPage = lazy(() => import("@/pages/RoutesPage").then(({ LegManagementPage }) => ({ default: LegManagementPage })));
const YearEndInspectionsAdminPage = lazy(() => import("@/pages/YearEndInspectionsAdminPage"));
const TripDetailPage = lazy(() => import("@/pages/TripDetailPage"));
const CallWorkspacePage = lazy(() => import("@/pages/CallWorkspacePage"));
const VoicemailInboxPage = lazy(() => import("@/pages/VoicemailInboxPage"));
const MobileCallLogPage = lazy(() => import("@/pages/MobileCallLogPage")) as LazyExoticComponent<ComponentType<any>>;
const NeedsAnswerPage = lazy(() => import("@/pages/NeedsAnswerPage"));
const EventProfilePage = lazy(() => import("@/pages/EventProfilePage"));
const EventProfileNewPage = lazy(() => import("@/pages/EventProfileNewPage"));
const EventProfileEditPage = lazy(() => import("@/pages/EventProfileEditPage"));
const ResearchSourcesPage = lazy(() => import("@/pages/ResearchSourcesPage"));
const AttendanceHistoryImportPage = lazy(() => import("@/pages/AttendanceHistoryImportPage"));
const LeadIntakePage = lazy(() => import("@/pages/LeadIntakePage"));
const PaperNotesInboxPage = lazy(() => import("@/pages/PaperNotesInboxPage"));
const PaperNoteBatchReviewPage = lazy(() => import("@/pages/PaperNoteBatchReviewPage"));
const SettingsBusinessSourcesPage = lazy(() => import("@/pages/SettingsBusinessSourcesPage"));
const SettingsCommunicationTemplatesPage = lazy(() => import("@/pages/SettingsCommunicationTemplatesPage"));
const DaveRequestsPage = lazy(() => import("@/pages/DaveRequestsPage"));
const ConventionOutreachPage = lazy(() => import("@/pages/ConventionOutreachPage"));
const SettingsCallScriptsPage = lazy(() => import("@/pages/SettingsCallScriptsPage"));
const SettingsPackagesResourcesPage = lazy(() => import("@/pages/SettingsPackagesResourcesPage"));
const SettingsGoogleWorkspacePage = lazy(() => import("@/pages/SettingsGoogleWorkspacePage"));
const DriveBackupPage = lazy(() => import("@/pages/DriveBackupPage"));
const SettingsContractsPage = lazy(() => import("@/pages/SettingsContractsPage"));
const EventDateCoveragePage = lazy(() => import("@/pages/EventDateCoveragePage"));
const BusinessDocumentsPage = lazy(() => import("@/pages/BusinessDocumentsPage"));
const OwnerInvoicesContractsPage = lazy(() => import("@/pages/OwnerInvoicesContractsPage"));
const OfficeInvoicesContractsPage = lazy(() => import("@/pages/OfficeInvoicesContractsPage"));
const BossInvoicesContractsPage = lazy(() => import("@/pages/BossInvoicesContractsPage"));
const BusinessDocumentImportPage = lazy(() => import("@/pages/BusinessDocumentImportPage"));
const EmailReviewPage = lazy(() => import("@/pages/EmailReviewPage"));
const ActMigrationPage = lazy(() => import("@/pages/ActMigrationPage"));
const ActRecoveryPage = lazy(() => import("@/pages/ActRecoveryPage"));
const NotFound = lazy(() => import("@/pages/not-found"));

const BossSignInPage = lazy(() => import("@/pages/BossSignInPage"));
const BossHomePage = lazy(() => import("@/pages/BossHomePage"));
const BossWorkRequestPage = lazy(() => import("@/pages/BossWorkRequestPage"));
const BossSchedulePage = lazy(() => import("@/pages/BossSchedulePage"));
const BossContactsPage = lazy(() => import("@/pages/BossContactsPage"));
const BossProfilesPage = lazy(() => import("@/pages/BossProfilesPage"));
const BossProfilePage = lazy(() => import("@/pages/BossProfilePage"));
const BossContactDetailPage = lazy(() => import("@/pages/BossContactDetailPage"));
const BossReceiptsPage = lazy(() => import("@/pages/BossReceiptsPage"));
const BossReviewsPage = lazy(() => import("@/pages/BossReviewsPage"));
const BossMaintenancePage = lazy(() => import("@/pages/BossMaintenancePage"));
const BossAssignmentsPage = lazy(() => import("@/pages/BossAssignmentsPage"));
const BossTemplatesFilesPage = lazy(() => import("@/pages/BossTemplatesFilesPage"));
const BossAccessPage = lazy(() => import("@/pages/BossAccessPage"));
const CoiManagementPage = lazy(() => import("@/pages/CoiManagementPage"));
const BossShell = lazy(() => import("@/components/boss/boss-shell").then(({ BossShell }) => ({ default: BossShell })));

const OfficeSignInPage = lazy(() => import("@/pages/OfficeSignInPage"));
const OfficeTodayPage = lazy(() => import("@/pages/OfficeTodayPage"));
const OfficeTasksPage = lazy(() => import("@/pages/OfficeTasksPage"));
const OfficeProfilesPage = lazy(() => import("@/pages/OfficeProfilesPage"));
const OfficeDocumentsPage = lazy(() => import("@/pages/OfficeDocumentsPage"));
const OfficeProfilePage = lazy(() => import("@/pages/OfficeProfilePage"));
const OfficeMailPage = lazy(() => import("@/pages/OfficeMailPage"));
const OfficeEmailDraftsPage = lazy(() => import("@/pages/OfficeEmailDraftsPage"));
const OfficeMessagesPage = lazy(() => import("@/pages/OfficeMessagesPage"));
const OfficeWebsiteInquiriesPage = lazy(() => import("@/pages/OfficeWebsiteInquiriesPage"));
const OfficeCoordinatorAdminPage = lazy(() => import("@/pages/OfficeCoordinatorAdminPage"));
const OfficeShell = lazy(() => import("@/components/office/office-shell").then(({ OfficeShell }) => ({ default: OfficeShell })));
const WebsiteInquiriesPage = lazy(() => import("@/pages/WebsiteInquiriesPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <img
          alt="The Adventure Zone"
          className="mx-auto h-auto w-64 max-w-[75vw]"
          src={`${basePath}/adventure-zone-logo.png`}
        />
        <p className="mt-1 text-sm font-medium text-muted-foreground">Command Terminal</p>
      </div>
      {children}
    </div>
  );
}

function SignInPage() {
  const { isSignedIn, signIn } = useAuth();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isSignedIn) return <Redirect to="/command" />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await signIn(password);
    setSubmitting(false);
    if (result.ok) setLocation("/command");
    else setError(result.error);
  }

  return (
    <AuthScreen>
      <form className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm" onSubmit={handleSubmit}>
        <label className="block text-sm font-semibold text-foreground" htmlFor="owner-password">Password</label>
        <input autoFocus autoComplete="current-password" className="mt-2" id="owner-password" onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" type="password" value={password} />
        {error ? <p className="mt-3 text-sm font-medium text-destructive" role="alert">{error}</p> : null}
        <Button className="mt-4 w-full" disabled={submitting || password.length === 0} type="submit">{submitting ? "Signing in…" : "Sign in"}</Button>
      </form>
      <Link href="/assistant/offline" className="mt-4 inline-flex min-h-12 items-center text-sm text-teal-800 underline">Open saved offline workspace</Link>
    </AuthScreen>
  );
}

function Landing() {
  return <><CommandTerminalLanding /><div className="p-4 text-center"><Link href="/assistant/offline" className="inline-flex min-h-12 items-center text-sm text-teal-800 underline">Open saved offline workspace</Link></div></>;
}

function LoadingScreen() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><p className="text-sm font-medium text-muted-foreground">Loading…</p></div>;
}

function HomeRoute() {
  const { isSignedIn } = useAuth();
  if (isSignedIn === null) return <LoadingScreen />;
  return isSignedIn ? <Redirect to="/command" /> : <Landing />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  if (isSignedIn === null) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect to="/" />;
  return <>{children}</>;
}

function CallsRedirect({ addMode = false }: { addMode?: boolean }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  if (addMode) params.set("mode", "add");
  const value = params.toString();
  return <Redirect to={canonicalCallsPath(value ? `?${value}` : "")} />;
}

function CallLogRedirect() {
  const search = useSearch();
  return <Redirect to={canonicalCallLogPath(search ? `?${search}` : "")} />;
}

function ScheduleRedirect({ view = "calendar" }: { view?: "calendar" | "map" }) {
  const search = useSearch();
  return <Redirect to={canonicalSchedulePath({ view, search: search ? `?${search}` : "" })} />;
}

function ProfilesRedirect() {
  const search = useSearch();
  return <Redirect to={canonicalProfilesPath(search ? `?${search}` : "")} />;
}

function ActMigrationRedirect() {
  const search = useSearch();
  return <Redirect to={canonicalActMigrationPath(search ? `?${search}` : "")} />;
}

function SettingsStub() {
  const tools = [
    ["ChatGPT connection", "/settings/chatgpt-connection", "Manage direct access, review profile changes and find saved app drafts."],
    ["Business sources", "/settings/business-sources", "Review protected business source files, conflicts, links, and historical terms."],
    ["Certificates of insurance", "/settings/coi", "Create, review, and renew workspace-scoped certificates linked to Studio files."],
    ["Excel lead lists", "/imports/leads", "Import Amy's event lists and review every source row before research or drafting."],
    ["Attendance history", "/imports/attendance-history", "Review historical attendance records before attaching them to profiles."],
    ["Email templates", "/settings/communication-templates", "Maintain reviewed communication templates and placeholder wording."],
    ["Paper notes", "/settings/paper-notes", "Review imported paper booking notes."],
    ["ACT import", "/settings/act-migration", "Migration and source import tools."],
    ["ACT recovery", "/settings/act-recovery", "Recover and repair archived ACT records."],
    ["Call scripts", "/settings/call-scripts", "Manage guided calling copy and branches."],
    ["Packages & resources", "/settings/packages-resources", "Maintain shared package and resource defaults."],
    ["Contracts & signing", "/settings/contracts", "Maintain future-draft signer and insurance recipient defaults."],
    ["Event date coverage", "/settings/event-date-coverage", "Find, research, and review the next event date for every profile."],
  ] as const;
  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Administrator maintenance</p>
        <h1 className="mt-1 text-3xl font-bold text-foreground">Admin Tools</h1>
        <p className="mt-2 text-muted-foreground">Imports, recovery, shared setup, and system-level tools stay here instead of cluttering Booking, Marketing, or Operations.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {tools.map(([label, href, description]) => (
          <Link className="rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary/40 transition-colors" href={href} key={href}>
            <h2 className="font-bold text-foreground">{label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </Link>
        ))}
      </div>
      <section className="rounded-xl border border-dashed border-border bg-card p-4">
        <h2 className="font-bold text-foreground">Google Workspace</h2>
        <p className="mt-1 text-sm text-muted-foreground">The approved Gmail/Calendar connection, sync, backfill, and review controls plug into Admin Tools as that implementation lands. Booking and Marketing consume the same shared synced data.</p>
      </section>
    </div>
  );
}

function ManagerProtectedApp() {
  const { manager, loading } = useManagerAuth();
  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><p className="text-sm font-medium text-muted-foreground">Loading manager portal…</p></div>;
  if (!manager) return <Redirect to="/manager/sign-in" />;
  return (
    <ManagerShell>
      <Switch>
        <Route path="/manager/incidents/new"><ManagerIncidentPage /></Route>
        <Route path="/manager/incidents"><ManagerIncidentsPage /></Route>
        <Route path="/manager/events/:bookingId/checklist/:phase">{(params)=><ManagerEventChecklistPage bookingId={params.bookingId} phaseSlug={params.phase}/>}</Route>
        <Route path="/manager/events/:bookingId/wrap-up">{(params)=><ManagerEventWrapUpPage bookingId={params.bookingId}/>}</Route>
        <Route path="/manager/reviews"><ManagerEventReviewPage /></Route>
        <Route path="/manager/crew/:workerId">{(params)=><ManagerWorkerPage workerId={params.workerId}/>}</Route>
        <Route path="/manager/crew"><ManagerCrewPage /></Route>
        <Route path="/manager/year-end-inspection"><ManagerYearEndInspectionPage /></Route>
        <Route path="/manager/operations"><ManagerOperationsPage /></Route>
        <Route path="/manager/receipts"><ManagerReceiptsPage /></Route>
        <Route path="/manager/money"><ManagerMoneyPage /></Route>
        <Route path="/manager/route"><ManagerRoutePage /></Route>
        <Route path="/manager/messages"><ManagerMessagesPage /></Route>
        <Route path="/manager"><ManagerHomePage /></Route>
      </Switch>
    </ManagerShell>
  );
}

function OfficeProtectedApp() {
  const { office, loading } = useOfficeAuth();
  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><p className="text-sm font-medium text-muted-foreground">Loading Booking Workspace…</p></div>;
  if (!office) return <Redirect to="/office/sign-in" />;
  return (
    <OfficeShell>
      <Switch>
        <Route path="/office/website-inquiries">
          {office.canReviewWebsiteInquiries ? <OfficeWebsiteInquiriesPage /> : <Redirect to="/office" />}
        </Route>
        <Route path="/office/profiles/:profileId">{(params)=><OfficeProfilePage profileId={params.profileId}/>}</Route>
        <Route path="/office/profiles" component={OfficeProfilesPage} />
        <Route path="/office/documents" component={OfficeDocumentsPage} />
        <Route path="/office/invoices-contracts" component={OfficeInvoicesContractsPage} />
        <Route path="/office/mail" component={OfficeMailPage} />
        <Route path="/office/emails" component={OfficeEmailDraftsPage} />
        <Route path="/office/tasks" component={OfficeTasksPage} />
        <Route path="/office/messages" component={OfficeMessagesPage} />
        <Route path="/office" component={OfficeTodayPage} />
      </Switch>
    </OfficeShell>
  );
}

function BossProtectedApp() {
  const { boss, loading } = useBossAuth();
  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><p className="text-sm font-medium text-muted-foreground">Loading Boss Workspace…</p></div>;
  if (!boss) return <Redirect to="/boss/sign-in" />;
  return (
    <BossShell>
      <Switch>
        <Route path="/boss/bookings/:id"><Redirect to="/boss/schedule" /></Route>
        <Route path="/boss/bookings"><Redirect to="/boss/schedule" /></Route>
        <Route path="/boss/schedule" component={BossSchedulePage} />
        <Route path="/boss/contacts/:id">{(params) => <BossContactDetailPage contactId={params.id} />}</Route>
        <Route path="/boss/contacts" component={BossContactsPage} />
        <Route path="/boss/profiles/:profileId">{(params) => <BossProfilePage profileId={params.profileId} />}</Route>
        <Route path="/boss/profiles" component={BossProfilesPage} />
        <Route path="/boss/receipts" component={BossReceiptsPage} />
        <Route path="/boss/reviews" component={BossReviewsPage} />
        <Route path="/boss/maintenance" component={BossMaintenancePage} />
        <Route path="/boss/assignments" component={BossAssignmentsPage} />
        <Route path="/boss/design-studio/:id"><Redirect to="/boss" /></Route>
        <Route path="/boss/design-studio"><Redirect to="/boss" /></Route>
        <Route path="/boss/templates-files" component={BossTemplatesFilesPage} />
        <Route path="/boss/invoices-contracts" component={BossInvoicesContractsPage} />
        <Route path="/boss/coi"><CoiManagementPage mode="boss" /></Route>
        {/* Redirect away from disallowed paths */}
        <Route path="/boss/today"><Redirect to="/boss" /></Route>
        <Route path="/boss/tasks"><Redirect to="/boss" /></Route>
        <Route path="/boss/work-requests/:requestId">{(params) => <BossWorkRequestPage requestId={params.requestId} />}</Route>
        <Route path="/boss"><BossHomePage /></Route>
        <Route path="/boss/conventions"><ConventionOutreachPage boss /></Route>
      </Switch>
    </BossShell>
  );
}

function AdminProtectedApp() {
  return (
    <AssistantContextProvider><WorkspaceSessionProvider>
      <AppShell>
        <Switch>
          <Route path="/assistant/workspace/:conversationId">{() => null}</Route>
          <Route path="/assistant/workspace">{() => null}</Route>
          <Route path="/command" component={AdminCommandPanelPage} />
          <Route path="/marketing" component={MarketingHomePage} />
          <Route path="/design-studio/email-templates" component={SettingsCommunicationTemplatesPage} />
          <Route path="/design-studio/:id" component={DesignStudioEditorPage} />
          <Route path="/design-studio" component={DesignStudioPage} />
          <Route path="/today" component={TodayPage} />
          <Route path="/website-inquiries" component={WebsiteInquiriesPage} />
          <Route path="/email-review" component={EmailReviewPage} />
          <Route path="/dave-requests" component={DaveRequestsPage} />
          <Route path="/conventions" component={ConventionOutreachPage} />
          <Route path="/bookings" component={BookingsPage} />
          <Route path="/bookings/:id/edit">{(params)=><BookingEditPage bookingId={params.id}/>}</Route>
          <Route path="/bookings/:id">{(params)=><BookingDetailPage bookingId={params.id}/>}</Route>
          <Route path="/contracts/drafts/:draftId">{(params)=><ContractBuilderPage draftId={params.draftId}/>}</Route>
          <Route path="/contracts/:contractVersionId/handoff">{(params)=><ContractHandoffPage contractVersionId={params.contractVersionId}/>}</Route>
          <Route path="/contacts/new" component={ContactNewPage} />
          <Route path="/contacts/:id/edit"><ContactEditPage /></Route>
          <Route path="/contacts/:id">{(params)=><ContactDetailPage contactId={params.id}/>}</Route>
          <Route path="/contacts" component={ContactsPage} />
          <Route path="/settings/chatgpt-connection" component={SettingsChatGPTConnectionPage} />
          <Route path="/chatgpt-connection/consent" component={ChatGPTConnectionConsentPage} />
          <Route path="/profiles/:profileId" component={EventProfilePage} />
          <Route path="/profiles" component={OrganizationsPage} />
          <Route path="/organizations"><ProfilesRedirect /></Route>
          <Route path="/event-families/:id"><EventFamilyPage /></Route>
          <Route path="/business-documents/import" component={BusinessDocumentImportPage} />
          <Route path="/business-documents" component={BusinessDocumentsPage} />
          <Route path="/invoices-contracts" component={OwnerInvoicesContractsPage} />
          <Route path="/schedule" component={SchedulePage} />
          <Route path="/calendar"><ScheduleRedirect /></Route>
          <Route path="/routes"><ScheduleRedirect view="map" /></Route>
          <Route path="/operations/legs" component={LegManagementPage} />
          <Route path="/year-end-inspections" component={YearEndInspectionsAdminPage} />
          <Route path="/research-sources" component={ResearchSourcesPage} />
          <Route path="/imports/leads" component={LeadIntakePage} />
          <Route path="/imports/attendance-history" component={AttendanceHistoryImportPage} />
          <Route path="/trips/:id"><TripDetailPage /></Route>
          <Route path="/calls/new"><CallsRedirect /></Route>
          <Route path="/calls/log" component={MobileCallLogPage} />
          <Route path="/calls/workspace" component={CallWorkspacePage} />
          <Route path="/calls/voicemail" component={VoicemailInboxPage} />
          <Route path="/calls/mobile"><CallLogRedirect /></Route>
          <Route path="/needs-answer" component={NeedsAnswerPage} />
          <Route path="/event-profiles/new" component={EventProfileNewPage} />
          <Route path="/event-profiles/:id/edit"><EventProfileEditPage /></Route>
          <Route path="/event-profiles/:id">{(params)=><Redirect to={canonicalProfilePath(params.id)} />}</Route>
          <Route path="/settings/paper-notes/:batchId">{(params)=><PaperNoteBatchReviewPage batchId={params.batchId}/>}</Route>
          <Route path="/settings/paper-notes" component={PaperNotesInboxPage} />
          <Route path="/settings/business-sources" component={SettingsBusinessSourcesPage} />
          <Route path="/settings/coi"><CoiManagementPage mode="admin" /></Route>
          <Route path="/settings/communication-templates" component={SettingsCommunicationTemplatesPage} />
          <Route path="/settings/call-scripts" component={SettingsCallScriptsPage} />
          <Route path="/settings/packages-resources" component={SettingsPackagesResourcesPage} />
          <Route path="/settings/contracts" component={SettingsContractsPage} />
          <Route path="/settings/event-date-coverage" component={EventDateCoveragePage} />
          <Route path="/settings/google-workspace/backup"><DriveBackupPage /></Route>
          <Route path="/settings/google-workspace"><SettingsGoogleWorkspacePage /></Route>
          <Route path="/settings/act-migration" component={ActMigrationPage} />
          <Route path="/settings/act-recovery" component={ActRecoveryPage} />
          <Route path="/settings" component={SettingsStub} />
          <Route path="/act-migration"><ActMigrationRedirect /></Route>
          <Route path="/quick-add"><CallsRedirect addMode /></Route>
          <Route path="/office-coordinator" component={OfficeCoordinatorAdminPage} />
          <Route path="/boss-access" component={BossAccessPage} />
          <Route path="/manager-finance" component={ManagerFinanceAdminPage} />
          <Route path="/manager-communications" component={ManagerCommunicationsAdminPage} />
          <Route path="/manager-crew" component={ManagerCrewAdminPage} />
          <Route path={ADMIN_WRAP_UP_PATH}>{(params)=><EventWrapUpAdminPage bookingId={params.bookingId}/>}</Route>
          <Route path={ADMIN_AFTERMATH_PATH} component={ManagerAftermathAdminPage} />
          <Route path="/manager-issues" component={ManagerIssuesAdminPage} />
          <Route component={NotFound} />
        </Switch>
      </AppShell>
    </WorkspaceSessionProvider></AssistantContextProvider>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Switch>
        <Route path="/assistant/offline" component={AssistantOfflinePage} />
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/office/sign-in"><OfficeAuthProvider><OfficeSignInPage /></OfficeAuthProvider></Route>
        <Route path={OFFICE_PROTECTED_PATH}><OfficeAuthProvider><OfficeProtectedApp /></OfficeAuthProvider></Route>
        <Route path="/office"><OfficeAuthProvider><OfficeProtectedApp /></OfficeAuthProvider></Route>
        <Route path="/manager/sign-in"><ManagerAuthProvider><ManagerSignInPage /></ManagerAuthProvider></Route>
        <Route path={MANAGER_PROTECTED_PATH}><ManagerAuthProvider><ManagerProtectedApp /></ManagerAuthProvider></Route>
        <Route path="/manager"><ManagerAuthProvider><ManagerProtectedApp /></ManagerAuthProvider></Route>
        <Route path="/boss/sign-in"><BossAuthProvider><BossSignInPage /></BossAuthProvider></Route>
        <Route path={BOSS_PROTECTED_PATH}><BossAuthProvider><BossProtectedApp /></BossAuthProvider></Route>
        <Route path="/boss"><BossAuthProvider><BossProtectedApp /></BossAuthProvider></Route>
        <Route><Protected><AdminProtectedApp /></Protected></Route>
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={basePath}>
        <AuthProvider>
          <OfflineBanner />
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}
