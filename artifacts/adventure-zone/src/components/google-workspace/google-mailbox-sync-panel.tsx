import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth-token";
type Item = {
  threadId: string;
  profileId: string;
  profileName: string;
  state: string;
  draftCount: number;
  checkedAt: string;
  availability: string;
  errorCode?: string;
};
type Detail = {
  ownerDecision?: string;
  followups: { id: string; kind: string; dueAt: string }[];
  snapshot: {
    drafts?: { id: string; bodyText: string }[];
    latestEmail?: { bodyText: string };
  };
};
const names: Record<string, string> = {
  owner_decision: "Owner decision needed",
  draft_to_review: "Draft to review",
  draft_missing: "Draft missing — check Gmail",
  reply_to_review: "Reply to review",
  waiting_for_reply: "Waiting for reply",
  contact_blocked: "Contact needs fixing",
  needs_review: "Review needed",
};
const base = "/email-thread-attention/sync";
async function read(path: string, post = false) {
  const r = await apiFetch(
    base + path,
    post
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      : undefined,
  );
  if (!r.ok)
    throw Error("Sync is unavailable. Showing the last saved information.");
  return r.json();
}
export function GoogleMailboxSyncPanel() {
  const [items, setItems] = useState<Item[]>([]),
    [status, setStatus] = useState<{
      pending?: number;
      blocked?: number;
      linkReview?: number;
      archivePending?: number;
      phase?: string;
      lastSuccessAt?: string;
      errorCode?: string;
    }>({}),
    [cursor, setCursor] = useState(""),
    [next, setNext] = useState<string | null>(null),
    [detail, setDetail] = useState<Record<string, Detail>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reviews, setReviews] = useState<{
    items: {
      threadId: string;
      subject: string;
      gmailUrl: string;
      candidateProfileIds: string[];
    }[];
    nextCursor: string | null;
  } | null>(null);
  async function reviewLinks(page = "") {
    setError("");
    try {
      setReviews(
        await read(
          "/reviews" + (page ? "?cursor=" + encodeURIComponent(page) : ""),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function load(page = "") {
    setBusy(true);
    setError("");
    try {
      const [s, p] = await Promise.all([
        read("/status"),
        read(
          "/threads?limit=25" +
            (page ? "&cursor=" + encodeURIComponent(page) : ""),
        ),
      ]);
      setStatus(s);
      setItems(p.items);
      setNext(p.nextCursor);
      setCursor(page);
      setDetail({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus(await read("/check", true));
      setNotice(
        "Sync requested. Refresh this view to see the latest saved results.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setError("");
    try {
      const value = await read("/thread?threadId=" + encodeURIComponent(id));
      setDetail((old) => ({ ...old, [id]: value }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section
      className="my-4 rounded-xl border bg-card p-4"
      aria-label="Customer email sync"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Customer email sync</h2>
        <div className="flex gap-3">
          <button disabled={busy} onClick={() => void check()}>
            Check now
          </button>
          <button disabled={busy} onClick={() => void load(cursor)}>
            Refresh view
          </button>
        </div>
      </div>
      <p className="my-2 text-sm">
        {status.pending ?? 0} updates pending · {status.blocked ?? 0} sync
        issues ·{" "}
        {status.phase === "ready"
          ? "Checking mailbox changes"
          : status.phase
            ? "Catching up"
            : "Loading status"}
      </p>
      <p className="text-sm">
        {status.archivePending ?? 0} email archives pending ·{" "}
        {status.linkReview ?? 0} conversations need a profile checked
      </p>
      {!!status.linkReview && (
        <button className="underline" onClick={() => void reviewLinks()}>
          Review uncertain profile links
        </button>
      )}
      {reviews && (
        <div className="my-3 rounded border p-3">
          <h3>Profile links to check</h3>
          {reviews.items.map((r) => (
            <p key={r.threadId}>
              <a
                href={r.gmailUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {r.subject || "Open conversation in Gmail"}
              </a>{" "}
              ·{" "}
              {r.candidateProfileIds.length > 1
                ? "Several possible profiles"
                : "Profile needs checking"}
            </p>
          ))}
          {reviews.nextCursor && (
            <button onClick={() => void reviewLinks(reviews.nextCursor!)}>
              More uncertain links
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Last mailbox check:{" "}
        {status.lastSuccessAt
          ? new Date(status.lastSuccessAt).toLocaleString()
          : "Not yet"}
        . Follow-ups remain open until you review them.
      </p>
      {(error || status.errorCode) && (
        <p role="alert">
          {error ||
            "Sync needs attention. Saved customer information is retained."}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="my-3 grid gap-3 lg:grid-cols-3">
        {items.map((item) => (
          <article className="rounded border p-3" key={item.threadId}>
            <a
              href={"/profiles/" + item.profileId}
              className="font-semibold underline"
            >
              {item.profileName}
            </a>
            <p>{names[item.state] ?? "Review needed"}</p>
            {(item.errorCode || item.availability === "missing") && (
              <p className="text-sm">
                Gmail needs checking — showing saved information.
              </p>
            )}
            <p className="text-xs">
              {item.checkedAt ? new Date(item.checkedAt).toLocaleString() : ""}{" "}
              · {item.draftCount} drafts
            </p>
            {!detail[item.threadId] ? (
              <button
                className="mt-2 underline"
                onClick={() => void open(item.threadId)}
              >
                Review details
              </button>
            ) : (
              <div className="mt-2 text-sm">
                {detail[item.threadId].ownerDecision && (
                  <p>{detail[item.threadId].ownerDecision}</p>
                )}
                {detail[item.threadId].snapshot.drafts?.map((d) => (
                  <details key={d.id}>
                    <summary>Current unsent draft</summary>
                    <p className="whitespace-pre-wrap break-words">
                      {d.bodyText}
                    </p>
                  </details>
                ))}
                {detail[item.threadId].snapshot.latestEmail && (
                  <details>
                    <summary>Latest email</summary>
                    <p className="whitespace-pre-wrap break-words">
                      {detail[item.threadId].snapshot.latestEmail?.bodyText}
                    </p>
                  </details>
                )}
                <p>Open follow-ups: {detail[item.threadId].followups.length}</p>
                {detail[item.threadId].followups.map((f) => (
                  <p key={f.id}>
                    {f.kind} ·{" "}
                    {f.dueAt
                      ? new Date(f.dueAt).toLocaleDateString()
                      : "No date"}
                  </p>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="flex gap-4">
        {cursor && (
          <button disabled={busy} onClick={() => void load()}>
            First page
          </button>
        )}
        {next && (
          <button disabled={busy} onClick={() => void load(next)}>
            Next page
          </button>
        )}
      </div>
    </section>
  );
}
