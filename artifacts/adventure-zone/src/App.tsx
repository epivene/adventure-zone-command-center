import { ClerkProvider, Show, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from "wouter";

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
import QuickAddPage from "@/pages/QuickAddPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// REQUIRED — resolves the key from the current hostname so the same build
// serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev (Clerk hits dev FAPI directly), auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  variables: {
    colorPrimary: "#ea580c",
    colorForeground: "#0f172a",
    colorMutedForeground: "#64748b",
    colorBackground: "#ffffff",
    colorInput: "#ffffff",
    colorInputForeground: "#0f172a",
    colorNeutral: "#334155",
    colorDanger: "#dc2626",
    borderRadius: "0.5rem",
  },
};

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
  return (
    <AuthScreen>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthScreen>
  );
}

function SignUpPage() {
  return (
    <AuthScreen>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
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

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/today" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
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
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
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
              <Route path="/settings/{*rest}" component={SettingsStub} />
              <Route component={NotFound} />
            </Switch>
          </AppShell>
        </Protected>
      </Route>
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <OfflineBanner />
        <AppRoutes />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
