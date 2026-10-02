import { useState } from "react";
import {
  usePlanningClient,
  requestKey,
  type PlanningClient,
  type PlanningRole,
} from "@/features/leg-planning/planning-client";
import { usePlanningSetup } from "./use-planning-setup";
import { Field, inputClass, Readiness } from "./planning-fields";
export function ApprovalReview({
  requestId,
  role,
  onDecision,
  client: override,
}: {
  requestId: string;
  role: PlanningRole;
  onDecision?: () => void;
  client?: PlanningClient;
}) {
  const client = usePlanningClient(role, override),
    s = usePlanningSetup(`review:${requestId}`, client, () =>
      client.approvals(requestId),
    ),
    [reason, setReason] = useState(""),
    [strategic, setStrategic] = useState(false);
  const review = s.data?.find((r) => r.request.id === requestId);
  if (!review) return s.error ? <p role="alert">{s.error}</p> : null;
  const q = review.request,
    allowed = review.canDecide;
  const decide = (decision: "approved" | "declined" | "revoked") =>
    s.run(async () => {
      const result = await client.write(`/leg-approvals/${q.id}/decision`, {
        payload: {
          requestId: q.id,
          decision: {
            decision,
            reason: reason.trim(),
            strategicAcknowledgement: strategic,
          },
        },
        expectedRevision: q.revision,
        requestKey: requestKey(),
      });
      onDecision?.();
      return result;
    });
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer font-bold">
        {q.type.replaceAll("_", " ")} · {q.state}
      </summary>
      <div className="mt-3 grid min-w-0 gap-3">
        <p className="text-sm">
          {q.type === "split"
            ? "Dave or the parent leg manager must review both actual sites."
            : "Only the bound Dave account can approve this extra physical set."}
        </p>
        {review.plans.map((p) => {
          const d = p.plan?.draft ?? p.draft,
            c = p.catalog;
          return (
            <section
              key={d?.bookingId}
              className="grid gap-2 rounded-lg border p-3"
            >
              <h4 className="font-semibold">
                {c?.bookings.find((b) => b.id === d?.bookingId)?.name ??
                  d?.bookingId}
              </h4>
              {d ? (
                <>
                  <p className="text-sm">
                    Season {d.seasonYear} ·{" "}
                    {c?.legs.find((l) => l.id === d.legId)?.name ?? "Leg"} ·{" "}
                    {d.window?.startsAt ?? "Dates unknown"} to{" "}
                    {d.window?.endsAt ?? "Dates unknown"} ({d.window?.semantics}
                    )
                  </p>
                  <p className="text-sm">
                    Minimum crew: {d.requirements.minimumCrew ?? "Unknown"} ·
                    Required roles:{" "}
                    {d.requirements.roles === null
                      ? "Unknown"
                      : Object.entries(d.requirements.roles)
                          .map(([role, count]) => `${role}: ${count}`)
                          .join(", ") || "None"}
                  </p>
                  {d.crew.map((w) => (
                    <p className="text-sm" key={w.workerId}>
                      {c?.workers.find((x) => x.id === w.workerId)?.name ??
                        "Recorded worker"}{" "}
                      · {w.role} · {w.state} · {w.window.startsAt} to{" "}
                      {w.window.endsAt}
                    </p>
                  ))}
                  <p className="text-sm">
                    Sets:{" "}
                    {d.packageSetIds
                      .map(
                        (id) =>
                          c?.packageSets.find((x) => x.id === id)?.name ?? id,
                      )
                      .join(", ") || "Not recorded"}
                  </p>
                  <p className="text-sm">
                    Transport:{" "}
                    {d.transportResourceIds
                      .map(
                        (id) =>
                          c?.resources.find((x) => x.id === id)?.name ?? id,
                      )
                      .join(", ") || "Not recorded"}
                  </p>
                  <p className="text-sm">
                    Accommodation: {d.requirements.lodging}
                  </p>
                  {d.lodging.map((l) => (
                    <p className="text-sm" key={l.id}>
                      {l.description} · {l.location} · sleeps {l.capacity} ·{" "}
                      {l.window.startsAt} to {l.window.endsAt} ·{" "}
                      {l.source.label}
                    </p>
                  ))}
                  <p className="text-sm">
                    Travel review:{" "}
                    {d.travelReview?.source.label ?? "Not recorded"}
                  </p>
                </>
              ) : null}
              <Readiness read={p} />
            </section>
          );
        })}
        {review.plans
          .flatMap((p) => p.decisions.filter((d) => d.requestId === q.id))
          .filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i)
          .map((d) => (
            <p className="text-sm" key={d.id}>
              {d.decision} ·{" "}
              {d.actor.kind === "manager"
                ? `Parent leg credential ${d.actor.legId}`
                : d.actor.kind === "boss"
                  ? `Boss account ${d.actor.accountId}`
                  : "Owner"}{" "}
              · {d.decidedAt} · {d.reason}
            </p>
          ))}
        {s.error ? <p role="alert">{s.error}</p> : null}
        {allowed ? (
          <>
            <Field label="Decision reason">
              <textarea
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {q.type === "split" ? (
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={strategic}
                  onChange={(e) => setStrategic(e.target.checked)}
                />
                I reviewed the strategic impact if both sites need full
                Adventure Zone crews.
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {(["approved", "declined", "revoked"] as const).map(
                (decision) => (
                  <button
                    type="button"
                    disabled={s.busy || !reason.trim()}
                    className="button-secondary"
                    key={decision}
                    onClick={() => void decide(decision)}
                  >
                    {decision === "approved"
                      ? "Approve exact plan"
                      : decision === "declined"
                        ? "Decline request"
                        : "Revoke approval"}
                  </button>
                ),
              )}
            </div>
          </>
        ) : (
          <p className="text-sm">
            This account can read the facts; the authorized reviewer records the
            decision.
          </p>
        )}
      </div>
    </details>
  );
}
export function ApprovalQueue({
  role,
  client: override,
}: {
  role: PlanningRole;
  client?: PlanningClient;
}) {
  const client = usePlanningClient(role, override),
    s = usePlanningSetup(`approval-queue:${role}`, client, () =>
      client.approvals(),
    );
  if (!s.data) return null;
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-bold">
        Leg approval reviews
      </summary>
      <div className="mt-3 grid gap-3">
        {s.error ? <p role="alert">{s.error}</p> : null}
        {s.data?.map((r) => (
          <ApprovalReview
            key={r.request.id}
            requestId={r.request.id}
            role={role}
            client={client}
            onDecision={() => void s.reload()}
          />
        ))}
        {s.data?.length === 0 ? (
          <p className="text-sm">No recorded review requests.</p>
        ) : null}
      </div>
    </details>
  );
}
