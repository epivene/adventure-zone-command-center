import { useEffect, useState } from "react";
import { CheckCircle2, Cloud, LockKeyhole, Unplug } from "lucide-react";

import { GoogleHistoricalBackfill } from "@/components/google-workspace/google-historical-backfill";
import { GoogleRecentValidation } from "@/components/google-workspace/google-recent-validation";
import { GoogleScopePreview } from "@/components/google-workspace/google-scope-preview";
import {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceSettings,
  previewGoogleWorkspaceScope,
  runGoogleWorkspaceRecentValidation,
  saveGoogleWorkspaceScope,
  startGoogleWorkspaceOAuth,
  type GoogleRecentValidationResult,
  type GoogleWorkspaceScopePreview as GoogleScopePreviewView,
  type GoogleWorkspaceSettingsView,
} from "@/features/google-workspace/google-workspace-client";

type Props = {
  openAuthorizationUrl?(url: string): void;
  confirmDisconnect?(): boolean;
};

type GoogleWorkspaceOAuthReturn = {
  error: string | null;
  notice: string | null;
};

const defaultOpenAuthorizationUrl = (url: string) => window.location.assign(url);
const defaultConfirmDisconnect = () =>
  window.confirm(
    "Disconnect the company Google account? Existing saved scope remains available, but no Google access will be possible until it is connected again.",
  );

export function readGoogleWorkspaceOAuthReturn(
  search: string,
): GoogleWorkspaceOAuthReturn {
  const params = new URLSearchParams(search);
  if (params.get("connected") === "1") {
    return {
      error: null,
      notice: "Google account connected in read-only mode.",
    };
  }

  const providerError = params.get("googleError");
  if (providerError === "GOOGLE_WORKSPACE_OAUTH_ACCESS_DENIED") {
    return {
      error: "Google connection was cancelled. Nothing was connected or changed.",
      notice: null,
    };
  }
  if (providerError === "GOOGLE_WORKSPACE_OAUTH_PROVIDER_REJECTED") {
    return {
      error: "Google did not complete the connection. Nothing was connected or changed.",
      notice: null,
    };
  }
  return { error: null, notice: null };
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/40"
      role="alert"
    >
      <p className="font-semibold text-rose-800 dark:text-rose-200">
        Google Workspace needs attention
      </p>
      <p className="mt-1 break-words text-sm text-rose-700 dark:text-rose-300">
        {message}
      </p>
    </div>
  );
}

function SavedScope({ settings }: { settings: GoogleWorkspaceSettingsView }) {
  if (settings.labels.length === 0 && settings.calendars.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No business scope has been approved yet. Preview the account before saving anything.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Saved Gmail labels
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-800">
          {settings.labels.map((label) => (
            <li className="flex items-center gap-2" key={label.id}>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>{label.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Saved calendars
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-800">
          {settings.calendars.map((calendar) => (
            <li className="flex items-center gap-2" key={calendar.id}>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>{calendar.summary}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SettingsGoogleWorkspacePage({
  openAuthorizationUrl = defaultOpenAuthorizationUrl,
  confirmDisconnect = defaultConfirmDisconnect,
}: Props = {}) {
  const [oauthReturn] = useState(() =>
    readGoogleWorkspaceOAuthReturn(
      typeof window === "undefined" ? "" : window.location.search,
    ),
  );
  const [settings, setSettings] = useState<GoogleWorkspaceSettingsView | null>(null);
  const [preview, setPreview] = useState<GoogleScopePreviewView | null>(null);
  const [validation, setValidation] = useState<GoogleRecentValidationResult | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<
    "connect" | "preview" | "save" | "validation" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(oauthReturn.error);
  const [notice, setNotice] = useState<string | null>(oauthReturn.notice);

  useEffect(() => {
    let active = true;
    getGoogleWorkspaceSettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setSelectedLabelIds(value.labels.map((label) => label.id));
        setSelectedCalendarIds(value.calendars.map((calendar) => calendar.id));
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load Google Workspace settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const previewHasMissingSources = Boolean(
    preview &&
      (preview.missingLabelRoots.length > 0 ||
        preview.missingCalendars.length > 0),
  );
  const requiredLabelIds = preview
    ? preview.labels
        .filter((label) => label.id === label.rootId)
        .map((label) => label.id)
    : [];
  const previewHasIncompleteSelection = Boolean(
    preview &&
      (requiredLabelIds.some((id) => !selectedLabelIds.includes(id)) ||
        selectedCalendarIds.length !== preview.calendars.length ||
        preview.calendars.some(
          (calendar) => !selectedCalendarIds.includes(calendar.id),
        )),
  );
  const previewCannotSave =
    previewHasMissingSources || previewHasIncompleteSelection;

  async function connect() {
    setBusy("connect");
    setError(null);
    setNotice(null);
    try {
      const result = await startGoogleWorkspaceOAuth();
      openAuthorizationUrl(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start Google connection.");
      setBusy(null);
    }
  }

  async function loadPreview() {
    setBusy("preview");
    setError(null);
    setNotice(null);
    try {
      const value = await previewGoogleWorkspaceScope();
      setPreview(value);
      setSelectedLabelIds(value.labels.map((label) => label.id));
      setSelectedCalendarIds(value.calendars.map((calendar) => calendar.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not preview Google business scope.");
    } finally {
      setBusy(null);
    }
  }

  async function saveScope() {
    if (previewHasMissingSources) {
      setError(
        "Resolve every missing or ambiguous business source before saving.",
      );
      return;
    }
    if (previewHasIncompleteSelection) {
      setError(
        "Keep the main business folders and all approved calendars selected. Individual subfolders may be unchecked.",
      );
      return;
    }
    if (selectedLabelIds.length === 0 || selectedCalendarIds.length === 0) {
      setError("Select at least one business Gmail label and one Google Calendar.");
      return;
    }
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const saved = await saveGoogleWorkspaceScope({
        labelIds: selectedLabelIds,
        calendarIds: selectedCalendarIds,
      });
      setSettings((current) =>
        current
          ? { ...current, labels: saved.labels, calendars: saved.calendars }
          : current,
      );
      setNotice("Business scope saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Google business scope.");
    } finally {
      setBusy(null);
    }
  }

  async function runValidation() {
    setBusy("validation");
    setError(null);
    setNotice(null);
    try {
      const result = await runGoogleWorkspaceRecentValidation(100);
      setValidation(result);
      setNotice("Recent email check finished. Review the matches before historical import is enabled.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check recent Gmail history.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirmDisconnect()) return;
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    try {
      await disconnectGoogleWorkspace();
      setPreview(null);
      setValidation(null);
      setSelectedLabelIds([]);
      setSelectedCalendarIds([]);
      setSettings((current) =>
        current
          ? { ...current, connection: null, labels: [], calendars: [] }
          : current,
      );
      setNotice("Google account disconnected.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect Google Workspace.");
    } finally {
      setBusy(null);
    }
  }

  function setLabel(id: string, selected: boolean) {
    setSelectedLabelIds((current) =>
      selected
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id),
    );
  }

  function setCalendar(id: string, selected: boolean) {
    setSelectedCalendarIds((current) =>
      selected
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id),
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 pb-10">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700 dark:text-orange-300">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Google Workspace</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Read access for approved company Gmail labels, files, and calendars, plus Gmail draft creation.
          Existing connections must reconnect once to authorize the narrow Gmail compose scope.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Draft-only Gmail compose</p>
          <p className="mt-1 text-sm text-blue-800 dark:text-blue-300">
            This release can create a reviewed Gmail draft only. It cannot send email, move messages, change Gmail labels, or edit Google Calendar events.
          </p>
        </div>
      </div>

      {loading ? <p className="text-slate-500">Loading Google Workspace settings…</p> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {notice ? (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {!loading && settings ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Cloud className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <h2 className="text-xl font-bold">Company Google account</h2>
                </div>
                {!settings.configured ? (
                  <p className="mt-3 max-w-2xl text-sm text-amber-800 dark:text-amber-300">
                    Google Workspace is not configured on the server. Finish the secure server setup before connecting the company account.
                  </p>
                ) : settings.connection ? (
                  <div className="mt-3">
                    <p className="font-semibold text-slate-900">
                      {settings.connection.email}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Status: {settings.connection.status === "connected" ? "Connected" : "Reconnect required"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">
                    No company Google account is connected yet.
                  </p>
                )}
              </div>

              {settings.configured ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="button-primary px-4 py-2"
                    disabled={busy !== null}
                    onClick={() => void connect()}
                    type="button"
                  >
                    {busy === "connect"
                      ? "Opening Google…"
                      : settings.connection
                        ? "Reconnect Google account"
                        : "Connect Google account"}
                  </button>
                  {settings.connection ? (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                      disabled={busy !== null}
                      onClick={() => void disconnect()}
                      type="button"
                    >
                      <Unplug className="h-4 w-4" />
                      Disconnect Google account
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          {settings.connection ? (
            <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Business-only scope</h2>
                  <p className="mt-1 max-w-2xl text-sm text-slate-600">
                    Preview the account, keep the main business folders and calendars selected, and uncheck any individual subfolders you do not want included.
                  </p>
                </div>
                <button
                  className="button-secondary px-4 py-2"
                  disabled={busy !== null}
                  onClick={() => void loadPreview()}
                  type="button"
                >
                  {busy === "preview" ? "Checking Google…" : "Preview business scope"}
                </button>
              </div>

              {preview ? (
                <>
                  <GoogleScopePreview
                    onCalendarChange={setCalendar}
                    onLabelChange={setLabel}
                    preview={preview}
                    selectedCalendarIds={selectedCalendarIds}
                    selectedLabelIds={selectedLabelIds}
                  />
                  {previewHasMissingSources ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Resolve every missing or ambiguous business source before saving.
                    </p>
                  ) : null}
                  {previewHasIncompleteSelection ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Keep the main business folders and all approved calendars selected. Individual subfolders may be unchecked.
                    </p>
                  ) : null}
                  <div className="flex justify-end border-t border-slate-200 pt-4">
                    <button
                      className="button-primary px-5 py-2.5"
                      disabled={busy !== null || previewCannotSave}
                      onClick={() => void saveScope()}
                      type="button"
                    >
                      {busy === "save" ? "Saving…" : "Save business scope"}
                    </button>
                  </div>
                </>
              ) : (
                <SavedScope settings={settings} />
              )}
            </section>
          ) : null}

          {settings.connection && settings.labels.length > 0 ? (
            <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950/20">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Recent email safety check</h2>
                  <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                    Check the newest 100 normal Gmail messages, excluding Spam and Trash, so profile-related or clearly business-related mail is not left behind just because it lives outside one of the saved folders.
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    This safety check does not itself start the historical import.
                  </p>
                </div>
                <button
                  className="button-primary px-4 py-2"
                  disabled={busy !== null}
                  onClick={() => void runValidation()}
                  type="button"
                >
                  {busy === "validation" ? "Checking 100 emails…" : "Run recent email check"}
                </button>
              </div>
              {validation ? <GoogleRecentValidation result={validation} /> : null}
            </section>
          ) : null}

          {settings.connection && settings.labels.length > 0 ? (
            <GoogleHistoricalBackfill />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default SettingsGoogleWorkspacePage;