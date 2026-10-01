import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth-token";
type ReviewRecord = {
  id: string;
  displayName?: string;
  fileAvailable?: boolean;
  kind?: string;
  dueAt?: string;
  completedAt?: string | null;
  outcome?: string | null;
};
export function WorkRecordReview({
  profileId,
  kind,
  recordId,
}: {
  profileId: string;
  kind: string | null;
  recordId: string | null;
}) {
  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = (kind === "document" || kind === "followup") && !!recordId;
  useEffect(() => {
    let live = true;
    setRecord(null);
    setError("");
    setUrl("");
    if (!valid) return;
    async function load() {
      let found: ReviewRecord | undefined;
      if (kind === "document") {
        for (let offset = 0; ; offset += 100) {
          const r = await apiFetch(
            `/business-documents?profileId=${encodeURIComponent(profileId)}&limit=100&offset=${offset}`,
          );
          if (!r.ok) throw Error("Could not load the linked document.");
          const page = (await r.json()).documents as ReviewRecord[];
          found = page.find((d) => d.id === recordId);
          if (!live || found || page.length < 100) break;
        }
      } else {
        const r = await apiFetch(
          `/event-profiles/${encodeURIComponent(profileId)}`,
        );
        if (!r.ok) throw Error("Could not load the linked follow-up.");
        found = ((await r.json()).followUps ?? []).find(
          (f: ReviewRecord) => f.id === recordId,
        );
      }
      if (!live) return;
      if (!found)
        throw Error(
          "This linked record is no longer available on this profile.",
        );
      setRecord(found);
    }
    void load().catch((e) => {
      if (live) setError(e.message);
    });
    return () => {
      live = false;
    };
  }, [profileId, kind, recordId, valid]);
  useEffect(() => {
    if (record)
      document
        .getElementById("work-record-review")
        ?.scrollIntoView?.({ block: "start" });
  }, [record]);
  async function openFile() {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch(
        `/business-documents/${encodeURIComponent(recordId!)}/open`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (!r.ok) throw Error("That protected file is not available right now.");
      const candidate = new URL((await r.json()).url, window.location.origin);
      if (
        candidate.protocol !== "https:" &&
        candidate.origin !== window.location.origin
      )
        throw Error("The file link is unavailable.");
      setUrl(candidate.href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!valid) return null;
  return (
    <section
      id="work-record-review"
      aria-label="Linked work record"
      className="mb-4 grid gap-2 rounded border p-4"
    >
      <h2 className="font-semibold">
        {kind === "document" ? "Document review" : "Follow-up review"}
      </h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : !record ? (
        <p role="status">Loading linked record…</p>
      ) : null}
      {record ? (
        <>
          <p>{record.displayName ?? record.kind}</p>
          {kind === "followup" ? (
            <>
              <p>
                {record.completedAt ? "Completed" : "Open"}
                {record.dueAt
                  ? ` · Due ${new Date(record.dueAt).toLocaleString()}`
                  : ""}
              </p>
              <p>{record.outcome}</p>
            </>
          ) : url ? (
            <a
              className="underline"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open protected file
            </a>
          ) : (
            <button
              className="button-secondary justify-self-start"
              disabled={busy || !record.fileAvailable}
              onClick={() => void openFile()}
            >
              Get file link
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
