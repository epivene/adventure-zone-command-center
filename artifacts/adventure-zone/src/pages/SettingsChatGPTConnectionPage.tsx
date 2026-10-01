import { useEffect, useState, type FormEvent } from "react";
import { MergePreview } from "@/features/chatgpt-connection/merge-preview";
import {
  connectionRequest,
  scopeLabels,
  connectionButton,
} from "@/features/chatgpt-connection/client";
export default function SettingsChatGPTConnectionPage() {
  const [settings, setSettings] = useState<any>(null),
    [drafts, setDrafts] = useState<any[]>([]),
    [proposals, setProposals] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [approval, setApproval] = useState<any>(null),
    [draftCursor, setDraftCursor] = useState<string | null>(null),
    [proposalCursor, setProposalCursor] = useState<string | null>(null);
  async function load() {
    const [s, d, p] = await Promise.all([
      connectionRequest(),
      connectionRequest("/drafts"),
      connectionRequest("/proposals"),
    ]);
    const params = new URLSearchParams(window.location.search);
    for (const [key, page, route] of [
      ["draft", d, "/drafts"],
      ["proposal", p, "/proposals"],
    ] as const) {
      const id = params.get(key);
      if (id && !page.items.some((item: any) => item.id === id)) {
        page.items.unshift(
          await connectionRequest(`${route}/${encodeURIComponent(id)}`),
        );
      }
    }
    setSettings(s);
    setDrafts(d.items);
    setProposals(p.items);
    setDraftCursor(d.nextCursor);
    setProposalCursor(p.nextCursor);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("draft")
      ? "draft-" + params.get("draft")
      : "proposal-" + params.get("proposal");
    document.getElementById(target)?.scrollIntoView?.({ block: "center" });
  }, [drafts, proposals]);
  async function older(type: "drafts" | "proposals", cursor: string) {
    setBusy(true);
    setError("");
    try {
      const page = await connectionRequest(
        `/${type}?cursor=${encodeURIComponent(cursor)}`,
      );
      const append = (old: any[]) => [
        ...old,
        ...page.items.filter((item: any) => !old.some((x) => x.id === item.id)),
      ];
      if (type === "drafts") {
        setDrafts(append);
        setDraftCursor(page.nextCursor);
      } else {
        setProposals(append);
        setProposalCursor(page.nextCursor);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await connectionRequest(path, body, settings.csrfToken);
      if (result.approvalId) setApproval(result);
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void act("/clients", {
      name: String(data.get("name")),
      redirectUris: [String(data.get("redirectUri"))],
    });
  }
  return (
    <main className="mx-auto grid w-full max-w-4xl min-w-0 gap-5 p-3 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">ChatGPT connection</h1>
        <p>
          Work with Command Center from ChatGPT. Reads and saves here do not
          invoke the app’s AI. ChatGPT usage and app hosting remain subject to
          their own plans.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded border border-red-400 p-3">
          {error} Refresh before retrying an uncertain change.
        </p>
      )}
      <button
        className={connectionButton}
        disabled={busy}
        onClick={() => {
          setError("");
          void load().catch((e) => setError(e.message));
        }}
      >
        Refresh connection status
      </button>
      {!settings ? (
        <p>Loading connection settings…</p>
      ) : (
        <>
          <section className="grid min-w-0 gap-2 rounded border p-4">
            <h2 className="text-lg font-semibold">Setup</h2>
            <p>
              {settings.enabled
                ? "Connection enabled"
                : "Connection disabled — setup requires a reviewed deployment and server configuration."}
            </p>
            <code className="break-all">{settings.endpoint}</code>
            <p>
              Register the exact callback URL supplied by your ChatGPT client.
              Start with read-only access, then select additional permissions on
              the consent screen.
            </p>
            <form onSubmit={register} className="grid gap-3">
              <label>
                Client name
                <input
                  className="block w-full rounded border p-2"
                  name="name"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Exact HTTPS callback URL
                <input
                  className="block w-full rounded border p-2"
                  name="redirectUri"
                  type="url"
                  required
                />
              </label>
              <button
                className={connectionButton}
                disabled={busy || !settings.enabled}
              >
                Register client
              </button>
            </form>
            {settings.clients.map((client: any) => (
              <div key={client.id} className="min-w-0 border-t pt-2">
                <strong>{client.metadata.client_name}</strong>
                <p className="break-all">Client ID: {client.id}</p>
                {client.metadata.redirect_uris.map((uri: string) => (
                  <p key={uri} className="break-all">
                    {uri}
                  </p>
                ))}
              </div>
            ))}
          </section>
          <section className="grid gap-3 rounded border p-4">
            <h2 className="text-lg font-semibold">Authorized connections</h2>
            {!settings.connections.length && (
              <p>No connections authorized yet.</p>
            )}
            {settings.connections.map((c: any) => (
              <article key={c.id} className="grid gap-2 border-t pt-3">
                <p>
                  Client:{" "}
                  {settings.clients.find((x: any) => x.id === c.client_id)
                    ?.metadata.client_name ?? c.client_id}
                </p>
                <ul>
                  {c.scopes.map((s: string) => (
                    <li key={s}>{scopeLabels[s] ?? s}</li>
                  ))}
                </ul>
                <p>
                  Last used:{" "}
                  {c.last_used_at
                    ? new Date(c.last_used_at).toLocaleString("en-US", {
                        timeZone: "America/Denver",
                      })
                    : "Not yet used"}{" "}
                  (Mountain time)
                </p>
                {c.revoked_at ? (
                  <p>Revoked</p>
                ) : (
                  <button
                    className={connectionButton}
                    disabled={busy}
                    onClick={() => void act(`/connections/${c.id}/revoke`, {})}
                  >
                    Revoke access
                  </button>
                )}
              </article>
            ))}
          </section>
          <section className="grid gap-3 rounded border p-4">
            <h2 className="text-lg font-semibold">Proposed profile changes</h2>
            <p>
              Approval covers only the changes shown and expires after 15
              minutes. Changed profiles or merge-related records require a fresh
              preview.
            </p>
            {!proposals.length && <p>No proposals to review.</p>}
            {proposals.map((p) => (
              <article
                id={"proposal-" + p.id}
                key={p.id}
                className="grid min-w-0 gap-2 border-t pt-3"
              >
                <h3 className="font-semibold">{p.content.profileName}</h3>
                {p.content.kind === "profile_merge" && (
                  <MergePreview
                    key={p.content_hash}
                    proposal={p}
                    disabled={busy || !settings.enabled}
                    approve={(body) =>
                      void act(`/proposals/${p.id}/approve-merge`, body)
                    }
                  />
                )}
                {Object.entries(p.content.values ?? {}).map(
                  ([field, value]) => (
                    <div
                      key={field}
                      className="grid gap-1 rounded bg-muted p-2 sm:grid-cols-3"
                    >
                      <strong>{field}</strong>
                      <span className="break-words">
                        Current: {p.content.oldValues[field] ?? "(empty)"}
                      </span>
                      <span className="break-words">
                        Proposed: {String(value ?? "(empty)")}
                      </span>
                    </div>
                  ),
                )}
                <details>
                  <summary>Source evidence</summary>
                  {p.content.sources.map((s: any, i: number) => (
                    <p key={i} className="break-words">
                      {s.claim} — {s.verification},{" "}
                      {s.eventYear ?? "year unknown"} —{" "}
                      <a
                        className="underline break-all"
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.url}
                      </a>
                    </p>
                  ))}
                </details>
                {p.consumed_at ? (
                  <p>Applied</p>
                ) : p.approved_at ? (
                  <p>
                    Approved until{" "}
                    {new Date(p.approval_expires_at).toLocaleString("en-US", {
                      timeZone: "America/Denver",
                    })}{" "}
                    Mountain time. Approval ID:{" "}
                    <code className="break-all">{p.approval_id}</code>
                  </p>
                ) : p.content.kind !== "profile_merge" ? (
                  <button
                    className={connectionButton}
                    disabled={busy || !settings.enabled}
                    onClick={() =>
                      void act(`/proposals/${p.id}/approve`, {
                        contentHash: p.content_hash,
                      })
                    }
                  >
                    Approve these exact changes
                  </button>
                ) : null}
              </article>
            ))}
            {proposalCursor && (
              <button
                className={connectionButton}
                disabled={busy}
                onClick={() => void older("proposals", proposalCursor)}
              >
                Older proposals
              </button>
            )}
            {approval && (
              <p role="status" className="break-words">
                Approved. Return this approval ID to the requesting ChatGPT
                conversation:{" "}
                <code className="break-all">{approval.approvalId}</code>
              </p>
            )}
          </section>
          <section className="grid gap-3 rounded border p-4">
            <h2 className="text-lg font-semibold">Saved app drafts</h2>
            <p>
              These drafts are stored in Command Center. Sending requires a
              separate review.
            </p>
            {!drafts.length && <p>No saved drafts yet.</p>}
            {drafts.map((d) => (
              <article
                id={"draft-" + d.id}
                key={d.id}
                className="grid min-w-0 gap-2 border-t pt-3"
              >
                <h3 className="font-semibold">{d.content.subject}</h3>
                <p className="break-words">To: {d.content.to.join(", ")}</p>
                {d.content.cc.length > 0 && (
                  <p className="break-words">Cc: {d.content.cc.join(", ")}</p>
                )}
                <p className="whitespace-pre-wrap break-words">
                  {d.content.text}
                </p>
                <a
                  className="underline"
                  href={`/profiles/${d.content.organizationId}`}
                >
                  Open profile
                </a>
              </article>
            ))}
            {draftCursor && (
              <button
                className={connectionButton}
                disabled={busy}
                onClick={() => void older("drafts", draftCursor)}
              >
                Older drafts
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
