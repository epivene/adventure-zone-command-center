export type WorkspaceStatus = {
  enabled: boolean;
  ready: boolean;
  model: string | null;
  models: string[];
  providerVerification: "not_checked";
  checks: {
    id: string;
    label: string;
    state: "ready" | "needs_setup" | "unavailable" | "not_checked";
    required: boolean;
    message: string;
    keys?: string[];
    href?: string;
  }[];
};
const labels = {
  ready: "Ready locally",
  needs_setup: "Needs setup",
  unavailable: "Unavailable",
  not_checked: "Not tested",
};
export function SetupPanel({
  status,
  refreshing,
  onRefresh,
}: {
  status: WorkspaceStatus;
  refreshing: boolean;
  onRefresh(): void;
}) {
  return (
    <section
      aria-label="Assistant setup"
      className={`relative rounded-xl border border-slate-200 bg-white ${status.ready ? "mb-3 p-3" : "mb-5 p-5"}`}
    >
      <div
        className={
          status.ready
            ? "absolute right-3 top-3"
            : "flex flex-wrap items-start justify-between gap-3"
        }
      >
        {!status.ready && (
          <div>
            <h2 className="font-semibold text-slate-950">
              Finish connecting your assistant
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Complete the required setup below to open chat. OpenAI access has
              not been tested.
            </p>
          </div>
        )}
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="min-h-11 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {refreshing ? "Refreshing setup status…" : "Refresh setup status"}
        </button>
      </div>
      <details open={!status.ready} className={status.ready ? "" : "mt-4"}>
        <summary
          className={`cursor-pointer text-sm font-medium ${status.ready ? "min-h-11 py-3 pr-48" : ""}`}
        >
          Setup and connections
        </summary>
        {status.ready && (
          <p className="mt-3 text-sm text-slate-600">
            Local setup is ready. OpenAI access has not been tested.
          </p>
        )}
        {[true, false].map((required) => (
          <div key={String(required)} className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">
              {required
                ? "Required for chat"
                : "Optional connections and actions"}
            </h3>
            <ul className="space-y-3">
              {(status.checks ?? [])
                .filter((check) => check.required === required)
                .map((check) => (
                  <li
                    key={check.id}
                    className="rounded-lg bg-slate-50 p-3 text-sm"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{check.label}</span>
                      <span
                        className={
                          check.state === "ready"
                            ? "text-teal-800"
                            : "text-slate-600"
                        }
                      >
                        {labels[check.state]}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{check.message}</p>
                    {!!check.keys?.length && check.state !== "ready" && (
                      <details className="mt-2">
                        <summary className="cursor-pointer">
                          Server settings
                        </summary>
                        <ul className="mt-1 break-all">
                          {check.keys.map((key) => (
                            <li key={key}>
                              <code>{key}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <a
          href="/settings/google-workspace"
          className="mt-4 inline-block font-medium text-teal-800 underline"
        >
          Google settings
        </a>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Configure the API service in Render
          </summary>
          <p className="mt-2 text-slate-600">
            Open your API service’s Environment page. Keep the OpenAI key there.
            Select a model your OpenAI project can use, include the owner
            account, then enable the workspace and redeploy the API. Refresh
            this page after startup finishes.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-3 text-xs">{`OPENAI_API_KEY=<your server-side key>\nASSISTANT_OPENAI_MODEL=<your model ID>\nASSISTANT_WORKSPACE_ACTOR_IDS=owner\nASSISTANT_WORKSPACE_ENABLED=true`}</pre>
          <p className="mt-2 text-slate-600">
            For a model picker, set ASSISTANT_OPENAI_MODELS to a comma-separated
            list that includes the default model. Setup checks do not test
            billing or make provider requests.
          </p>
        </details>
      </details>
    </section>
  );
}
