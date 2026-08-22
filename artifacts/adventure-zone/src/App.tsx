import ManagerIssuesAdminPage from "@/pages/ManagerIssuesAdminPage";
import ManagerRoutePage from "@/pages/ManagerRoutePage";
import ManagerMoneyPage from "@/pages/ManagerMoneyPage";
import ManagerReceiptsPage from "@/pages/ManagerReceiptsPage";
import ManagerOperationsPage from "@/pages/ManagerOperationsPage";
import ManagerFinanceAdminPage from "@/pages/ManagerFinanceAdminPage";
import ManagerCommunicationsAdminPage from "@/pages/ManagerCommunicationsAdminPage";
import ManagerCrewAdminPage from "@/pages/ManagerCrewAdminPage";
import ManagerAftermathAdminPage from "@/pages/ManagerAftermathAdminPage";
import EventWrapUpAdminPage from "@/pages/EventWrapUpAdminPage";
import ManagerIncidentPage from "@/pages/ManagerIncidentPage";
import ManagerIncidentsPage from "@/pages/ManagerIncidentsPage";
import ManagerCrewPage from "@/pages/ManagerCrewPage";
import ManagerWorkerPage from "@/pages/ManagerWorkerPage";
import ManagerEventReviewPage from "@/pages/ManagerEventReviewPage";
import ManagerEventWrapUpPage from "@/pages/ManagerEventWrapUpPage";
import ManagerHomePage from "@/pages/ManagerHomePage";
import ManagerMessagesPage from "@/pages/ManagerMessagesPage";
import ManagerSignInPage from "@/pages/ManagerSignInPage";
import { ManagerShell } from "@/components/manager/manager-shell";
import { ManagerAuthProvider, useManagerAuth } from "@/lib/manager-auth-context";
import { MANAGER_PROTECTED_PATH } from "@/lib/manager-route-pattern";
import { ADMIN_AFTERMATH_PATH, ADMIN_WRAP_UP_PATH } from "@/lib/admin-aftermath-route";
import { useState, type FormEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { Link, Route, Switch, Router as WouterRouter, Redirect, useLocation } from "wouter";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/navigation/app-shell";
import { OfflineBanner } from "@/components/connectivity/offline-banner";
import { Toaster } from "@/components/ui/toaster";
import { AssistantContextProvider } from "@/features/assistant/assistant-context";

import AdminCommandPanelPage from "@/pages/AdminCommandPanelPage";
import MarketingHomePage from "@/pages/MarketingHomePage";
import TodayPage from "@/pages/TodayPage";
import BookingsPage from "@/pages/BookingsPage";
import BookingDetailPage from "@/pages/BookingDetailPage";
import BookingEditPage from "@/pages/BookingEditPage";
import ContactsPage from "@/pages/ContactsPage";
import ContactDetailPage from "@/pages/ContactDetailPage";
import ContactEditPage from "@/pages/ContactEditPage";
import ContactNewPage from "@/pages/ContactNewPage";
import OrganizationsPage from "@/pages/OrganizationsPage";
import EventFamilyPage from "@/pages/EventFamilyPage";
import SchedulePage from "@/pages/SchedulePage";
import CalendarPage from "@/pages/CalendarPage";
import RoutesPage from "@/pages/RoutesPage";
import TripDetailPage from "@/pages/TripDetailPage";
import CallWorkspacePage from "@/pages/CallWorkspacePage";
import MobileCallLogPage from "@/pages/MobileCallLogPage";
import NeedsAnswerPage from "@/pages/NeedsAnswerPage";
import EventProfilePage from "@/pages/EventProfilePage";
import EventProfileNewPage from "@/pages/EventProfileNewPage";
import EventProfileEditPage from "@/pages/EventProfileEditPage";
import ResearchSourcesPage from "@/pages/ResearchSourcesPage";
import PaperNotesInboxPage from "@/pages/PaperNotesInboxPage";
import PaperNoteBatchReviewPage from "@/pages/PaperNoteBatchReviewPage";
import SettingsCallScriptsPage from "@/pages/SettingsCallScriptsPage";
import SettingsPackagesResourcesPage from "@/pages/SettingsPackagesResourcesPage";
import ActMigrationPage from "@/pages/ActMigrationPage";
import ActRecoveryPage from "@/pages/ActRecoveryPage";
import QuickAddPage from "@/pages/QuickAddPage";
import NotFound from "@/pages/not-found";

import OfficeSignInPage from "@/pages/OfficeSignInPage";
import OfficeTodayPage from "@/pages/OfficeTodayPage";
import OfficeTasksPage from "@/pages/OfficeTasksPage";
import OfficeProfilesPage from "@/pages/OfficeProfilesPage";
import OfficeProfilePage from "@/pages/OfficeProfilePage";
import OfficeMailPage from "@/pages/OfficeMailPage";
import OfficeEmailDraftsPage from "@/pages/OfficeEmailDraftsPage";
import OfficeMessagesPage from "@/pages/OfficeMessagesPage";
import OfficeCoordinatorAdminPage from "@/pages/OfficeCoordinatorAdminPage";
import { OfficeAuthProvider, useOfficeAuth } from "@/lib/office-auth-context";
import { OFFICE_PROTECTED_PATH } from "@/lib/office-route-pattern";
import { OfficeShell } from "@/components/office/office-shell";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Adventure Zone</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">Command Center</p>
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
      <form className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleSubmit}>
        <label className="block text-sm font-semibold text-slate-700" htmlFor="owner-password">Password</label>
        <input autoFocus autoComplete="current-password" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" id="owner-password" onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" type="password" value={password} />
        {error ? <p className="mt-3 text-sm font-medium text-red-600" role="alert">{error}</p> : null}
        <button className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60" disabled={submitting || password.length === 0} type="submit">{submitting ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthScreen>
  );
}

function Landing() {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4">
      <Link aria-label="Administrator Access" className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-300" href="/sign-in" title="Administrator Access">
        <Shield aria-hidden="true" className="h-5 w-5" />
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Adventure Zone Command Center</h1>
      <p className="mt-2 max-w-md text-center text-slate-600">Bookings, contacts, routes, and calls all in one place!</p>
      <div className="mt-8 grid w-full max-w-sm gap-3">
        <Link className="button-primary px-6 py-3 text-center" href="/office/sign-in">Office Coordinator</Link>
        <Link className="button-secondary px-6 py-3 text-center" href="/manager/sign-in">Leg Managers</Link>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50"><p className="text-sm font-medium text-slate-500">Loading…</p></div>;
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

function SettingsStub() {
  const tools = [
    ["Paper notes", "/settings/paper-notes", "Review imported paper booking notes."],
    ["ACT import", "/settings/act-migration", "Migration and source import tools."],
    ["ACT recovery", "/settings/act-recovery", "Recover and repair archived ACT records."],
    ["Call scripts", "/settings/call-scripts", "Manage guided calling copy and branches."],
    ["Packages & resources", "/settings/packages-resources", "Maintain shared package and resource defaults."],
  ] as const;
  return <div className="mx-auto grid max-w-5xl gap-5"><header><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Administrator maintenance</p><h1 className="mt-1 text-3xl font-bold">Admin Tools</h1><p className="mt-2 text-slate-600">Imports, recovery, shared setup, and system-level tools stay here instead of cluttering Booking, Marketing, or Operations.</p></header><div className="grid gap-3 sm:grid-cols-2">{tools.map(([label, href, description]) => <Link className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-orange-300" href={href} key={href}><h2 className="font-bold">{label}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></Link>)}</div><section className="rounded-xl border border-dashed border-slate-300 bg-white p-4"><h2 className="font-bold">Google Workspace</h2><p className="mt-1 text-sm text-slate-600">The approved Gmail/Calendar connection, sync, backfill, and review controls plug into Admin Tools as that implementation lands. Booking and Marketing consume the same shared synced data.</p></section></div>;
}

function ManagerProtectedApp() {
  const { manager, loading } = useManagerAuth();
  if (loading) return <div className="p-6">Loading manager portal…</div>;
  if (!manager) return <Redirect to="/manager/sign-in" />;
  return (
    <ManagerShell>
      <Switch>
        <Route path="/manager/incidents/new"><ManagerIncidentPage /></Route>
        <Route path="/manager/incidents"><ManagerIncidentsPage /></Route>
        <Route path="/manager/events/:bookingId/wrap-up">{(params)=><ManagerEventWrapUpPage bookingId={params.bookingId}/>}</Route>
        <Route path="/manager/reviews"><ManagerEventReviewPage /></Route>
        <Route path="/manager/crew/:workerId">{(params)=><ManagerWorkerPage workerId={params.workerId}/>}</Route>
        <Route path="/manager/crew"><ManagerCrewPage /></Route>
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
  if (loading) return <div className="p-6">Loading Booking Workspace…</div>;
  if (!office) return <Redirect to="/office/sign-in" />;
  return (
    <OfficeShell>
      <Switch>
        <Route path="/office/profiles/:profileId">{(params)=><OfficeProfilePage profileId={params.profileId}/>}</Route>
        <Route path="/office/profiles" component={OfficeProfilesPage} />
        <Route path="/office/mail" component={OfficeMailPage} />
        <Route path="/office/emails" component={OfficeEmailDraftsPage} />
        <Route path="/office/tasks" component={OfficeTasksPage} />
        <Route path="/office/messages" component={OfficeMessagesPage} />
        <Route path="/office" component={OfficeTodayPage} />
      </Switch>
    </OfficeShell>
  );
}

function AdminProtectedApp() {
  return (
    <AssistantContextProvider>
      <AppShell>
        <Switch>
          <Route path="/command" component={AdminCommandPanelPage} />
          <Route path="/marketing" component={MarketingHomePage} />
          <Route path="/today" component={TodayPage} />
          <Route path="/bookings" component={BookingsPage} />
          <Route path="/bookings/:id/edit">{(params)=><BookingEditPage bookingId={params.id}/>}</Route>
          <Route path="/bookings/:id">{(params)=><BookingDetailPage bookingId={params.id}/>}</Route>
          <Route path="/contacts/new" component={ContactNewPage} />
          <Route path="/contacts/:id/edit">{(params)=><ContactEditPage contactId={params.id}/>}</Route>
          <Route path="/contacts/:id">{(params)=><ContactDetailPage contactId={params.id}/>}</Route>
          <Route path="/contacts" component={ContactsPage} />
          <Route path="/profiles/:profileId" component={EventProfilePage} />
          <Route path="/profiles" component={OrganizationsPage} />
          <Route path="/organizations" component={OrganizationsPage} />
          <Route path="/event-families/:id">{(params)=><EventFamilyPage familyId={params.id}/>}</Route>
          <Route path="/schedule" component={SchedulePage} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/routes" component={RoutesPage} />
          <Route path="/research-sources" component={ResearchSourcesPage} />
          <Route path="/trips/:id">{(params)=><TripDetailPage tripId={params.id}/>}</Route>
          <Route path="/calls/new" component={CallWorkspacePage} />
          <Route path="/calls/log" component={MobileCallLogPage} />
          <Route path="/calls/workspace" component={CallWorkspacePage} />
          <Route path="/calls/mobile" component={MobileCallLogPage} />
          <Route path="/needs-answer" component={NeedsAnswerPage} />
          <Route path="/event-profiles/new" component={EventProfileNewPage} />
          <Route path="/event-profiles/:id/edit">{(params)=><EventProfileEditPage profileId={params.id}/>}</Route>
          <Route path="/event-profiles/:id">{(params)=><EventProfilePage profileId={params.id}/>}</Route>
          <Route path="/settings/paper-notes/:batchId">{(params)=><PaperNoteBatchReviewPage batchId={params.batchId}/>}</Route>
          <Route path="/settings/paper-notes" component={PaperNotesInboxPage} />
          <Route path="/settings/call-scripts" component={SettingsCallScriptsPage} />
          <Route path="/settings/packages-resources" component={SettingsPackagesResourcesPage} />
          <Route path="/settings/act-migration" component={ActMigrationPage} />
          <Route path="/settings/act-recovery" component={ActRecoveryPage} />
          <Route path="/settings" component={SettingsStub} />
          <Route path="/act-migration" component={ActMigrationPage} />
          <Route path="/quick-add" component={QuickAddPage} />
          <Route path="/office-coordinator" component={OfficeCoordinatorAdminPage} />
          <Route path="/manager-finance" component={ManagerFinanceAdminPage} />
          <Route path="/manager-communications" component={ManagerCommunicationsAdminPage} />
          <Route path="/manager-crew" component={ManagerCrewAdminPage} />
          <Route path={ADMIN_WRAP_UP_PATH}>{(params)=><EventWrapUpAdminPage bookingId={params.bookingId}/>}</Route>
          <Route path={ADMIN_AFTERMATH_PATH} component={ManagerAftermathAdminPage} />
          <Route path="/manager-issues" component={ManagerIssuesAdminPage} />
          <Route component={NotFound} />
        </Switch>
      </AppShell>
    </AssistantContextProvider>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/office/sign-in"><OfficeAuthProvider><OfficeSignInPage /></OfficeAuthProvider></Route>
      <Route path={OFFICE_PROTECTED_PATH}><OfficeAuthProvider><OfficeProtectedApp /></OfficeAuthProvider></Route>
      <Route path="/office"><OfficeAuthProvider><OfficeProtectedApp /></OfficeAuthProvider></Route>
      <Route path="/manager/sign-in"><ManagerAuthProvider><ManagerSignInPage /></ManagerAuthProvider></Route>
      <Route path={MANAGER_PROTECTED_PATH}><ManagerAuthProvider><ManagerProtectedApp /></ManagerAuthProvider></Route>
      <Route path="/manager"><ManagerAuthProvider><ManagerProtectedApp /></ManagerAuthProvider></Route>
      <Route><Protected><AdminProtectedApp /></Protected></Route>
    </Switch>
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
