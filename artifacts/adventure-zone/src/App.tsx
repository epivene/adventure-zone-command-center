import { useState, type FormEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from "wouter";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/navigation/app-shell";
import { OfflineBanner } from "@/components/connectivity/offline-banner";

// Pages
import TodayPage from "@/pages/TodayPage";
import BookingsPage from "@/pages/BookingsPage";
import BookingDetailPage from "@/pages/BookingDetailPage";
import BookingEditPage from "@/pages/BookingEditPage";
import BookingNewPage from "@/pages/BookingNewPage";
import ContactsPage from "@/pages/ContactsPage";
import ContactDetailPage from "@/pages/ContactDetailPage";
import ContactEditPage from "@/pages/ContactEditPage";
import ContactNewPage from "@/pages/ContactNewPage";
import OrganizationsPage from "@/pages/OrganizationsPage";
import CalendarPage from "@/pages/CalendarPage";
import RoutesPage from "@/pages/RoutesPage";
import CallWorkspacePage from "@/pages/CallWorkspacePage";
import EventProfilePage from "@/pages/EventProfilePage";
import EventProfileNewPage from "@/pages/EventProfileNewPage";
import SettingsPackagesResourcesPage from "@/pages/SettingsPackagesResourcesPage";
import ActMigrationPage from "@/pages/ActMigrationPage";
import QuickAddPage from "@/pages/QuickAddPage";
import NotFound from "@/pages/not-found";

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

  if (isSignedIn) return <Redirect to="/today" />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await signIn(password);
    setSubmitting(false);
    if (result.ok) {
      setLocation("/today");
    } else {
      setError(result.error);
    }
  }

  return (
    <AuthScreen>
      <form
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <label className="block text-sm font-semibold text-slate-700" htmlFor="owner-password">
          Password
        </label>
        <input
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
          id="owner-password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          type="password"
          value={password}
        />
        {error ? (
          <p className="mt-3 text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60"
          disabled={submitting || password.length === 0}
          type="submit"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthScreen>
  );
}

function Landing() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4">
      <h1 className="text-3xl font-bold tracking-tight">Adventure Zone Command Center</h1>
      <p className="mt-2 max-w-md text-center text-slate-600">
        Bookings, contacts, routes, and calls for your adventure business — all in one place.
      </p>
      <button
        type="button"
        className="button-primary mt-8 px-6"
        onClick={() => setLocation("/sign-in")}
      >
        Sign in
      </button>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50">
      <p className="text-sm font-medium text-slate-500">Loading…</p>
    </div>
  );
}

function HomeRoute() {
  const { isSignedIn } = useAuth();
  if (isSignedIn === null) return <LoadingScreen />;
  return isSignedIn ? <Redirect to="/today" /> : <Landing />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  if (isSignedIn === null) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect to="/" />;
  return <>{children}</>;
}

function SettingsStub() {
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mt-8 text-2xl font-bold">Settings</h1>
      <p className="mt-2 text-slate-600">This settings page is available in the full backend setup.</p>
    </div>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in" component={SignInPage} />
      <Route>
        <Protected>
          <AppShell>
            <Switch>
              <Route path="/today" component={TodayPage} />
              <Route path="/bookings/new" component={BookingNewPage} />
              <Route path="/bookings/:bookingId/edit" component={BookingEditPage} />
              <Route path="/bookings/:bookingId" component={BookingDetailPage} />
              <Route path="/bookings" component={BookingsPage} />
              <Route path="/contacts/new" component={ContactNewPage} />
              <Route path="/contacts/:contactId/edit" component={ContactEditPage} />
              <Route path="/contacts/:contactId" component={ContactDetailPage} />
              <Route path="/contacts" component={ContactsPage} />
              <Route path="/profiles/:profileId">
                {(params) => <Redirect to={`/event-profiles/${params.profileId}`} />}
              </Route>
              <Route path="/profiles" component={OrganizationsPage} />
              <Route path="/organizations/:organizationId">
                {(params) => <Redirect to={`/event-profiles/${params.organizationId}`} />}
              </Route>
              <Route path="/organizations" component={OrganizationsPage} />
              <Route path="/calendar" component={CalendarPage} />
              <Route path="/routes" component={RoutesPage} />
              <Route path="/calls/new" component={CallWorkspacePage} />
              <Route path="/event-profiles/new" component={EventProfileNewPage} />
              <Route path="/event-profiles/:profileId" component={EventProfilePage} />
              <Route path="/quick-add" component={QuickAddPage} />
              <Route path="/settings/packages-resources" component={SettingsPackagesResourcesPage} />
              <Route path="/settings/act-migration" component={ActMigrationPage} />
              <Route path="/settings/{*rest}" component={SettingsStub} />
              <Route component={NotFound} />
            </Switch>
          </AppShell>
        </Protected>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <OfflineBanner />
          <AppRoutes />
        </QueryClientProvider>
      </AuthProvider>
    </WouterRouter>
  );
}

export default App;
