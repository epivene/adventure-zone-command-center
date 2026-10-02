import { useState } from "react";
import { type PlanDraft, type SplitGroup } from "@workspace/api-zod";
import { useLegPlan } from "@/features/leg-planning/use-leg-plan";
import {
  requestKey,
  type PlanningClient,
  type PlanningRole,
} from "@/features/leg-planning/planning-client";
import {
  Choices,
  Field,
  inputClass,
  Readiness,
  WindowFields,
  emptyWindow,
} from "./planning-fields";
import { ApprovalReview } from "./approval-review";
import { CrewAvailabilityEditor } from "./leg-season-editor";
export function EventPlanEditor({
  bookingId,
  role,
  onCommitted,
  client,
}: {
  bookingId: string;
  role: PlanningRole;
  onCommitted?: () => void;
  client?: PlanningClient;
}) {
  const p = useLegPlan(bookingId, role, client),
    [second, setSecond] = useState(""),
    [travelSource, setTravelSource] = useState("");
  const d = p.draft,
    r = p.data,
    c = r?.catalog;
  if (!r || !d || !c?.enabled)
    return p.error ? (
      <div className="rounded-xl border p-3">
        <p role="alert">{p.error}</p>
        <button type="button" onClick={() => void p.reload()}>
          Retry planning
        </button>
      </div>
    ) : null;
  const edit = (patch: Partial<PlanDraft>) => p.edit({ ...d, ...patch });
  const requirement = (patch: Partial<PlanDraft["requirements"]>) =>
    edit({ requirements: { ...d.requirements, ...patch } });
  const ready =
    !p.dirty &&
    !p.loading &&
    !p.error &&
    r.readiness.overall === "verified_plan" &&
    !!r.plan &&
    r.actions.commit;
  const splitIds =
    r.split?.bookingIds ??
    r.requests.find(
      (q) => q.type === "split" && q.bookingIds.includes(bookingId),
    )?.bookingIds;
  const request = (type: "split" | "extra_adventure_zone" | "extra_pirates") =>
    p.perform(() =>
      p.client.write("/leg-approvals", {
        payload: {
          type,
          parentLegId: d.legId,
          bookingIds: type === "split" ? (splitIds ?? []) : [bookingId],
        },
        expectedRevision: null,
        requestKey: requestKey(),
      }),
    );
  const prepareSplit = () =>
    p.perform(async () => {
      const secondId =
        r.split?.bookingIds.find((id) => id !== bookingId) ?? second;
      const other = await p.client.read(secondId),
        otherDraft = other.plan?.draft ?? other.draft;
      if (
        !otherDraft ||
        otherDraft.legId !== d.legId ||
        otherDraft.seasonYear !== d.seasonYear
      )
        throw new Error(
          "Both branches must use the same leg and selected season.",
        );
      const group = r.split
        ? { value: r.split }
        : await p.client.write<SplitGroup>("/leg-splits", {
            payload: {
              id: null,
              parentLegId: d.legId,
              bookingIds: [bookingId, secondId],
            },
            expectedRevision: null,
            requestKey: requestKey(),
          });
      await p.client.save(
        { ...d, splitGroupId: group.value.id },
        r.plan?.revision ?? null,
      );
      await p.client.save(
        { ...otherDraft, splitGroupId: group.value.id },
        other.plan?.revision ?? null,
      );
    });
  const commit = () =>
    p.perform(async () => {
      const ids = d.splitGroupId ? splitIds : [bookingId];
      if (!ids?.length)
        throw new Error(
          "Request review for the exact two saved branches first.",
        );
      const reads = await Promise.all(ids.map((id) => p.client.read(id)));
      if (reads.some((x) => !x.plan || x.readiness.overall !== "verified_plan"))
        throw new Error(
          "Both saved branches must be verified before commitment.",
        );
      const result = await p.client.write("/operating-plans/commit", {
        bookingIds: ids,
        expectedRevisions: Object.fromEntries(
          reads.map((x) => [x.plan!.bookingId, x.plan!.revision]),
        ),
        requestKey: requestKey(),
      });
      onCommitted?.();
      return result;
    });
  return (
    <section
      aria-label="Operating plan"
      className="grid min-w-0 gap-4 rounded-xl border p-4"
    >
      <header>
        <h3 className="text-lg font-bold">Operating plan</h3>
        <p className="text-sm text-slate-600">
          Save a draft, review the missing facts, then commit the verified
          allocation.
        </p>
      </header>
      <Readiness read={r} />
      {p.loading ? (
        <p className="text-sm">Checking current readiness…</p>
      ) : null}
      {p.revisionChanged ? (
        <p role="alert">
          The saved revision changed while you were editing. Your draft is
          retained; reread and deliberately discard or reapply your edits.
        </p>
      ) : null}
      {r.plan?.invalidationReasons.length ? (
        <p className="text-sm text-amber-800">
          Recorded facts changed. Review this plan before committing again.
        </p>
      ) : null}
      {p.error ? (
        <p role="alert" className="text-rose-800">
          {p.error} Your edits are retained.
        </p>
      ) : null}
      {p.error ? (
        <button
          type="button"
          className="button-secondary justify-self-start"
          disabled={p.busy}
          onClick={() => void p.reload()}
        >
          Retry current planning facts
        </button>
      ) : null}
      {p.dirty && r.plan ? (
        <p className="text-sm text-amber-800">
          Unsaved edits. Save before requesting approval or commitment.
        </p>
      ) : null}
      <fieldset
        disabled={!r.actions.edit || p.busy || !!p.error || p.loading}
        className="grid min-w-0 gap-3"
      >
        <Field label="Plan season">
          <input
            className={inputClass}
            type="number"
            min="1900"
            max="9998"
            value={d.seasonYear}
            onChange={(e) => edit({ seasonYear: Number(e.target.value) })}
          />
        </Field>
        <Field label="Planned leg">
          <select
            className={inputClass}
            value={c.legs.some((l) => l.id === d.legId) ? d.legId : ""}
            onChange={(e) => edit({ legId: e.target.value })}
          >
            <option value="">Choose a current leg</option>
            {c.legs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <WindowFields
          label="Reserved operations"
          value={d.window}
          onChange={(window) => edit({ window })}
        />
        <details>
          <summary className="cursor-pointer font-semibold">
            Arrival, setup, public operation, teardown &amp; departure
          </summary>
          <div className="mt-2 grid gap-2">
            {(
              [
                "arrival",
                "setup",
                "operating",
                "teardown",
                "departure",
              ] as const
            ).map((name) => (
              <div className="grid gap-1" key={name}>
                <WindowFields
                  label={name}
                  value={d.phases[name] ?? null}
                  onChange={(v) => edit({ phases: { ...d.phases, [name]: v } })}
                />
                {d.phases[name] ? (
                  <button
                    type="button"
                    onClick={() => {
                      const phases = { ...d.phases };
                      delete phases[name];
                      edit({ phases });
                    }}
                  >
                    Clear {name} phase
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
        <Field label="Minimum crew">
          <input
            className={inputClass}
            type="number"
            min="0"
            value={d.requirements.minimumCrew ?? ""}
            placeholder="Not established"
            onChange={(e) =>
              requirement({
                minimumCrew:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </Field>
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="font-semibold">Required roles</legend>
          {d.requirements.roles === null ? (
            <p className="text-sm">Not established</p>
          ) : null}
          {Object.entries(d.requirements.roles ?? {}).map(
            ([name, count], i) => (
              <div className="grid gap-2 sm:grid-cols-3" key={i}>
                <Field label={`Required role ${i + 1}`}>
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => {
                      const entries = Object.entries(
                        d.requirements.roles ?? {},
                      );
                      entries[i] = [e.target.value, count];
                      requirement({ roles: Object.fromEntries(entries) });
                    }}
                  />
                </Field>
                <Field label={`Role count ${i + 1}`}>
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    value={count}
                    onChange={(e) =>
                      requirement({
                        roles: {
                          ...d.requirements.roles,
                          [name]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => {
                    const roles = { ...d.requirements.roles };
                    delete roles[name];
                    requirement({ roles });
                  }}
                >
                  Remove role
                </button>
              </div>
            ),
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                requirement({
                  roles: { ...d.requirements.roles, ["New role"]: 1 },
                })
              }
            >
              Add required role
            </button>
            <button type="button" onClick={() => requirement({ roles: {} })}>
              Explicitly no specialized roles
            </button>
          </div>
        </fieldset>
        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="font-semibold">Event crew</legend>
          {d.crew.map((a, i) => (
            <div
              key={a.workerId || i}
              className="grid gap-2 rounded-lg border p-2"
            >
              <Field label={`Worker ${i + 1}`}>
                <select
                  className={inputClass}
                  value={a.workerId}
                  onChange={(e) =>
                    edit({
                      crew: d.crew.map((v, n) =>
                        n === i ? { ...v, workerId: e.target.value } : v,
                      ),
                    })
                  }
                >
                  <option value="">Choose a recorded worker</option>
                  {c.workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {w.rehireStatus}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Crew role ${i + 1}`}>
                <input
                  className={inputClass}
                  value={a.role}
                  onChange={(e) =>
                    edit({
                      crew: d.crew.map((v, n) =>
                        n === i ? { ...v, role: e.target.value } : v,
                      ),
                    })
                  }
                />
              </Field>
              <Field label={`Crew confirmation ${i + 1}`}>
                <select
                  className={inputClass}
                  value={a.state}
                  onChange={(e) =>
                    edit({
                      crew: d.crew.map((v, n) =>
                        n === i
                          ? { ...v, state: e.target.value as typeof a.state }
                          : v,
                      ),
                    })
                  }
                >
                  <option value="proposed">Proposed</option>
                  <option value="confirmed">Confirmed assignment</option>
                </select>
              </Field>
              <WindowFields
                label={`Crew shift ${i + 1}`}
                value={a.window}
                onChange={(window) =>
                  edit({
                    crew: d.crew.map((v, n) =>
                      n === i ? { ...v, window } : v,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() => edit({ crew: d.crew.filter((_, n) => n !== i) })}
              >
                Remove crew assignment {i + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              edit({
                crew: [
                  ...d.crew,
                  {
                    workerId: "",
                    role: "",
                    state: "proposed",
                    window: d.window ?? emptyWindow(),
                  },
                ],
              })
            }
          >
            Add crew assignment
          </button>
        </fieldset>
        <Choices
          label="Physical package sets"
          items={c.packageSets.map((s) => ({
            id: s.id,
            name: `${s.name} · ${s.state}`,
          }))}
          selected={d.packageSetIds}
          onChange={(packageSetIds) => edit({ packageSetIds })}
        />
        {role === "manager" ? (
          <p className="text-sm text-slate-600">
            The office assigns physical sets and transport for this leg.
          </p>
        ) : null}
        <Field label="Transport requirement">
          <select
            className={inputClass}
            value={
              d.requirements.transportRequired === null
                ? "unknown"
                : String(d.requirements.transportRequired)
            }
            onChange={(e) =>
              requirement({
                transportRequired:
                  e.target.value === "unknown"
                    ? null
                    : e.target.value === "true",
              })
            }
          >
            <option value="unknown">Not established</option>
            <option value="true">Required</option>
            <option value="false">Not required</option>
          </select>
        </Field>
        <Choices
          label="Actual vehicles, trailers & campers"
          items={c.resources.map((x) => ({
            id: x.id,
            name: `${x.name} · ${x.status}`,
          }))}
          selected={d.transportResourceIds}
          onChange={(transportResourceIds) => edit({ transportResourceIds })}
        />
        <Field label="Accommodation need">
          <select
            className={inputClass}
            value={d.requirements.lodging}
            onChange={(e) =>
              requirement({
                lodging: e.target.value as typeof d.requirements.lodging,
              })
            }
          >
            <option value="unknown">Unknown</option>
            <option value="required">Required</option>
            <option value="unnecessary">Unnecessary, with reason</option>
          </select>
        </Field>
        {d.requirements.lodging === "unnecessary" ? (
          <Field label="Accommodation unnecessary reason">
            <input
              className={inputClass}
              value={d.requirements.lodgingReason ?? ""}
              onChange={(e) =>
                requirement({ lodgingReason: e.target.value || null })
              }
            />
          </Field>
        ) : null}
        {d.lodging.map((l, i) => (
          <div className="grid gap-2 rounded-lg border p-3" key={l.id}>
            <Field label={`Lodging description ${i + 1}`}>
              <input
                className={inputClass}
                value={l.description}
                onChange={(e) =>
                  edit({
                    lodging: d.lodging.map((v, n) =>
                      n === i ? { ...v, description: e.target.value } : v,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Lodging location ${i + 1}`}>
              <input
                className={inputClass}
                value={l.location}
                onChange={(e) =>
                  edit({
                    lodging: d.lodging.map((v, n) =>
                      n === i ? { ...v, location: e.target.value } : v,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Lodging capacity ${i + 1}`}>
              <input
                className={inputClass}
                type="number"
                min="1"
                value={l.capacity}
                onChange={(e) =>
                  edit({
                    lodging: d.lodging.map((v, n) =>
                      n === i ? { ...v, capacity: Number(e.target.value) } : v,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Lodging source ${i + 1}`}>
              <input
                className={inputClass}
                value={l.source.label}
                onChange={(e) =>
                  edit({
                    lodging: d.lodging.map((v, n) =>
                      n === i
                        ? {
                            ...v,
                            source: {
                              label: e.target.value,
                              href: l.source.href,
                            },
                          }
                        : v,
                    ),
                  })
                }
              />
            </Field>
            <WindowFields
              label={`Lodging dates ${i + 1}`}
              value={l.window}
              onChange={(window) =>
                edit({
                  lodging: d.lodging.map((v, n) =>
                    n === i ? { ...v, window } : v,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                edit({ lodging: d.lodging.filter((_, n) => n !== i) })
              }
            >
              Remove lodging {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            edit({
              lodging: [
                ...d.lodging,
                {
                  id: requestKey(),
                  description: "",
                  location: "",
                  capacity: 1,
                  source: {
                    label: "",
                    href:
                      role === "manager"
                        ? `/manager/operations?bookingId=${bookingId}`
                        : role === "boss"
                          ? "/boss/schedule"
                          : `/bookings/${bookingId}/edit`,
                  },
                  window: d.window ?? emptyWindow(),
                },
              ],
            })
          }
        >
          Add recorded accommodation
        </button>
        <Field label="Verified load-in address">
          <input
            className={inputClass}
            value={d.loadInAddress ?? ""}
            onChange={(e) =>
              edit({
                loadInAddress: e.target.value || null,
                travelReview: null,
              })
            }
          />
        </Field>
        <Field label="Travel review source">
          <input
            className={inputClass}
            value={travelSource}
            onChange={(e) => setTravelSource(e.target.value)}
          />
        </Field>
        <button
          type="button"
          disabled={p.dirty || !r.travelReviewContext || !travelSource.trim()}
          onClick={() =>
            edit({
              travelReview: {
                endpointFingerprint: r.travelReviewContext!.endpointFingerprint,
                source: {
                  label: travelSource.trim(),
                  href:
                    role === "manager"
                      ? `/manager/operations?bookingId=${bookingId}`
                      : role === "boss"
                        ? "/boss/schedule"
                        : `/bookings/${bookingId}/edit`,
                },
              },
            })
          }
        >
          Record review of saved travel endpoints
        </button>
        <p className="text-xs text-slate-600">
          Save current locations and dates first. Record travel review only
          after checking the base, site, surrounding route and transfer time.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button-primary"
            onClick={() => void p.save()}
          >
            Save draft
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={p.discard}
          >
            Discard edits and use latest read
          </button>
        </div>
      </fieldset>
      <details>
        <summary className="cursor-pointer font-semibold">
          Dated worker availability
        </summary>
        <CrewAvailabilityEditor role={role} client={p.client} />
      </details>
      <fieldset
        className="grid gap-2"
        disabled={
          p.busy || p.dirty || !!p.error || p.loading || !r.actions.request
        }
      >
        <legend className="font-bold">Approvals</legend>
        <p className="text-sm">
          Splits reduce each site's crew. Dave or the parent leg manager reviews
          both actual branches; extra sets need Dave separately.
        </p>
        {!d.splitGroupId ? (
          <>
            <Field label="Second split event">
              <select
                className={inputClass}
                value={second}
                onChange={(e) => setSecond(e.target.value)}
              >
                <option value="">Choose exact second event</option>
                {c.bookings
                  .filter(
                    (b) =>
                      b.id !== bookingId &&
                      b.legId === d.legId &&
                      (b.splitSeasonYears ?? [b.seasonYear]).includes(
                        d.seasonYear,
                      ),
                  )
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={!second || !r.plan}
              onClick={() => void prepareSplit()}
            >
              Prepare two saved split branches
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">Split group: {d.splitGroupId}</p>
            {r.split ? (
              <button type="button" onClick={() => void prepareSplit()}>
                Finish or refresh both split branch drafts
              </button>
            ) : null}
            <button
              type="button"
              disabled={!splitIds}
              onClick={() => void request("split")}
            >
              Request split approval
            </button>
            {!splitIds ? (
              <button
                type="button"
                onClick={() =>
                  void p.perform(async () => {
                    const catalog = await p.client.catalog();
                    const reads = await Promise.all(
                      catalog.bookings
                        .filter(
                          (b) => b.legId === d.legId && b.id !== bookingId,
                        )
                        .map((b) => p.client.read(b.id)),
                    );
                    const other = reads.find(
                      (x) => x.plan?.draft.splitGroupId === d.splitGroupId,
                    );
                    if (!other?.plan)
                      throw new Error(
                        "Save both split branch drafts before requesting review.",
                      );
                    return p.client.write("/leg-approvals", {
                      payload: {
                        type: "split",
                        parentLegId: d.legId,
                        bookingIds: [bookingId, other.plan.bookingId],
                      },
                      expectedRevision: null,
                      requestKey: requestKey(),
                    });
                  })
                }
              >
                Request review of both split branches
              </button>
            ) : null}
          </>
        )}
        <button
          type="button"
          onClick={() => void request("extra_adventure_zone")}
        >
          Request extra Adventure Zone approval
        </button>
        <button type="button" onClick={() => void request("extra_pirates")}>
          Request extra Pirates approval
        </button>
      </fieldset>
      {r.requests.map((q) => (
        <ApprovalReview
          key={q.id}
          requestId={q.id}
          role={role}
          client={p.client}
          onDecision={() => void p.reload()}
        />
      ))}
      <button
        type="button"
        className="button-primary justify-self-start"
        disabled={!ready || p.busy}
        onClick={() => void commit()}
      >
        Commit verified plan
      </button>
    </section>
  );
}
