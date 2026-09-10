import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { decideEmailTemplate } from "@/features/boss-work-requests/boss-work-request-api";
import type {
  BossWorkRequestDetail,
  TemplateReview,
} from "@/features/boss-work-requests/boss-work-request-types";

export function EmailTemplateReview({
  detail,
  reload,
}: {
  detail: BossWorkRequestDetail;
  reload: () => Promise<void>;
}) {
  const reviews = detail.templateReviews;
  const firstPending = reviews.find((item) => item.decision === "pending")?.id ?? reviews[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(firstPending);

  useEffect(() => {
    if (!reviews.some((item) => item.id === selectedId && item.decision === "pending")) {
      setSelectedId(firstPending);
    }
  }, [firstPending, reviews, selectedId]);

  const selected = reviews.find((item) => item.id === selectedId) ?? reviews[0];
  const decided = reviews.filter((item) => item.decision !== "pending").length;
  if (!selected) return <p>Email previews are unavailable.</p>;

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Convention email review</p>
            <h2 className="mt-1 text-xl font-bold">{decided} of {reviews.length} decided</h2>
          </div>
          <div className="h-2 w-44 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${reviews.length ? (decided / reviews.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {reviews.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`rounded-lg border p-3 text-left ${item.id === selected.id ? "border-primary ring-1 ring-primary" : ""}`}
            >
              <span className="block text-xs font-bold uppercase text-muted-foreground">Email {index + 1}</span>
              <span className="mt-1 block font-semibold">{item.templateNameSnapshot}</span>
              <span className="mt-1 block text-xs">
                {item.decision === "pending" ? "Needs review" : item.decision.replaceAll("_", " ")}
              </span>
            </button>
          ))}
        </div>
      </section>
      <ReviewItem
        key={selected.id}
        requestId={detail.request.id}
        review={selected}
        reload={reload}
      />
    </div>
  );
}

function ReviewItem({
  requestId,
  review,
  reload,
}: {
  requestId: string;
  review: TemplateReview;
  reload: () => Promise<void>;
}) {
  const [note, setNote] = useState(review.note ?? "");
  const [verified, setVerified] = useState<Set<string>>(
    () => new Set(review.verifiedLinks.map((item) => item.href)),
  );
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const finished = review.decision !== "pending";
  const allLinksVerified = useMemo(
    () => review.safeLinks.every((link) => verified.has(link.href)),
    [review.safeLinks, verified],
  );
  const canApprove = !finished && !working && review.blockedLinks.length === 0 && allLinksVerified;

  function toggleLink(href: string, checked: boolean) {
    setVerified((current) => {
      const next = new Set(current);
      if (checked) next.add(href); else next.delete(href);
      return next;
    });
  }

  async function decide(decision: "approved" | "changes_requested") {
    if (decision === "changes_requested" && !note.trim()) {
      setError("Tell Desiree what you want changed.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      await decideEmailTemplate(
        requestId,
        review.id,
        decision,
        note.trim() || null,
        decision === "approved" ? [...verified] : [],
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answer.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">{review.templateNameSnapshot}</p>
            <h2 className="mt-2 text-lg font-bold">{review.subjectSnapshot || "(No subject)"}</h2>
          </div>
          <div className="flex rounded-lg border p-1">
            <button
              type="button"
              aria-label="Desktop preview"
              onClick={() => setPreviewWidth("desktop")}
              className={`rounded-md p-2 ${previewWidth === "desktop" ? "bg-primary text-primary-foreground" : ""}`}
            ><Monitor className="h-4 w-4" /></button>
            <button
              type="button"
              aria-label="Mobile preview"
              onClick={() => setPreviewWidth("mobile")}
              className={`rounded-md p-2 ${previewWidth === "mobile" ? "bg-primary text-primary-foreground" : ""}`}
            ><Smartphone className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-4 overflow-auto rounded-xl border bg-slate-100 p-2 sm:p-4">
          <div className={`mx-auto overflow-hidden rounded-lg bg-white transition-all ${previewWidth === "mobile" ? "max-w-[390px]" : "max-w-[760px]"}`}>
            {review.bodyFormatSnapshot === "html"
              ? <iframe title="Email template preview" sandbox="" srcDoc={review.bodySnapshot} className="min-h-[38rem] w-full" />
              : <pre className="min-h-64 whitespace-pre-wrap p-5 font-sans text-sm text-slate-900">{review.bodySnapshot}</pre>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h3 className="text-lg font-bold">Test every link</h3>
        <p className="mt-1 text-sm text-muted-foreground">Open each URL in a new tab, confirm it works, then check “Link works.”</p>
        {review.safeLinks.length === 0 && review.blockedLinks.length === 0
          ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">This email has no links to test.</p>
          : null}
        <div className="mt-4 grid gap-3">
          {review.safeLinks.map((link) => (
            <div key={link.href} className="rounded-lg border p-3">
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 break-all font-semibold text-primary underline"
              >
                {link.label}<ExternalLink className="h-4 w-4 shrink-0" />
              </a>
              <p className="mt-1 break-all text-xs text-muted-foreground">{link.href}</p>
              <label className="mt-3 flex min-h-11 items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  disabled={finished}
                  checked={verified.has(link.href)}
                  onChange={(event) => toggleLink(link.href, event.target.checked)}
                />
                Link works
              </label>
            </div>
          ))}
          {review.blockedLinks.map((link) => (
            <div key={`${link.href}:${link.reason}`} className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <p className="font-bold text-destructive">Cannot approve: {link.reason.replaceAll("_", " ")}</p>
              <p className="mt-1 break-all text-sm">{link.label}: {link.href || "(empty URL)"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <label className="grid gap-2 font-semibold">Notes for Desiree
          <textarea
            disabled={finished}
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What should be changed, or any approval notes…"
            className="rounded-lg border bg-background p-3 font-normal"
          />
        </label>
        {error && <p className="mt-2 text-sm font-semibold text-destructive">{error}</p>}
        {finished ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-muted p-3 font-semibold">
            <Check className="h-4 w-4" /> Answer saved: {review.decision.replaceAll("_", " ")}
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              disabled={working}
              onClick={() => void decide("changes_requested")}
              className="min-h-12 rounded-xl border px-4 font-bold"
            >Request Changes</button>
            <button
              disabled={!canApprove}
              onClick={() => void decide("approved")}
              className="min-h-12 rounded-xl bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50"
            >Approve This Email</button>
          </div>
        )}
      </section>
    </div>
  );
}
