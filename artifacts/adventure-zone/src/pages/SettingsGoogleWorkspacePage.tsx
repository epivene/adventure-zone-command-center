import { useEffect, useState } from "react";
import { CheckCircle2, Cloud, LockKeyhole, Unplug } from "lucide-react";

import { GoogleScopePreview } from "@/components/google-workspace/google-scope-preview";
import {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceSettings,
  previewGoogleWorkspaceScope,
  saveGoogleWorkspaceScope,
  startGoogleWorkspaceOAuth,
  type GoogleWorkspaceScopePreview as GoogleScopePreviewView,
  type GoogleWorkspaceSettingsView,
} from "@/features/google-workspace/google-workspace-client";

type Props = {
  openAuthorizationUrl?(url: string): void;
  confirmDisconnect?(): boolean;
};

const defaultOpenAuthorizationUrl = (url: string) => window.location.assign(url);
const defaultConfirmDisconnect = () =>
  window.confirm(
    "Disconnect the company Google account? Existing saved scope remains available, but no Google access will be possible until it is connected again.",
  );

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
      <p className="font-semibold text-rose-800">Google Workspace needs attention</p>
      <p className="mt-1 break-words text-sm text-rose-700">{message}</p>
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
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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
  const [settings, setSettings] = useState<GoogleWorkspaceSettingsView | null>(null);
  const [preview, setPreview] = useState<GoogleScopePreviewView | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<
    "connect" | "preview" | "save" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function disconnect() {
    if (!confirmDisconnect()) return;
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    try {
      await disconnectGoogleWorkspace();
      setPreview(null);
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
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Google Workspace</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Read-only connection for approved company Gmail labels, files, and calendars.
          Gmail and Google Calendar will not be changed.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Read-only by design</p>
          <p className="mt-1 text-sm text-blue-800">
            This release cannot send email, move messages, change Gmail labels, or edit Google Calendar events.
          </p>
        </div>
      </div>

      {loading ? <p className="text-slate-500">Loading Google Workspace settings…</p> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {!loading && settings ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Cloud className="h-5 w-5 text-orange-600" />
                  <h2 className="text-xl font-bold">Company Google account</h2>
                </div>
                {!settings.configured ? (
                  <p className="mt-3 max-w-2xl text-sm text-amber-800">
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
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
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
                    Preview the account, confirm the five business label groups and four business calendars, then save their Google IDs.
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
                  <div className="flex justify-end border-t border-slate-200 pt-4">
                    <button
                      className="button-primary px-5 py-2.5"
                      disabled={busy !== null}
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

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="font-bold text-slate-900">Historical syncing is not enabled yet</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              This phase only secures the connection and approved scope. Email, files, and calendar history will remain untouched until the recent-history validation controls are built and approved.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

export default SettingsGoogleWorkspacePage;
