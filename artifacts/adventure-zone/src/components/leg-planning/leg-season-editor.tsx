import { useEffect, useRef, useState } from "react";
import {
  crewAvailabilityInputSchema,
  legSeasonPlanInputSchema,
  type LegSeasonPlanInput,
  type CrewAvailabilityInput,
} from "@workspace/api-zod";
import {
  requestKey,
  usePlanningClient,
  type PlanningClient,
  type PlanningRole,
} from "@/features/leg-planning/planning-client";
import {
  Choices,
  Field,
  inputClass,
  WindowFields,
  emptyWindow,
} from "./planning-fields";
import { usePlanningSetup } from "./use-planning-setup";
export function LegSeasonEditor({
  legId,
  seasonYear,
  role,
  client: override,
}: {
  legId: string;
  seasonYear: number;
  role: PlanningRole;
  client?: PlanningClient;
}) {
  const client = usePlanningClient(role, override),
    key = `${legId}:${seasonYear}`,
    s = usePlanningSetup(key, client, async () => ({
      catalog: await client.catalog(),
      plan: await client.season(legId, seasonYear),
    }));
  const [draft, setDraft] = useState<LegSeasonPlanInput | null>(null),
    base = useRef<number | null>(null),
    identity = useRef(""),
    dirty = useRef(false);
  useEffect(() => {
    if (identity.current !== key) {
      identity.current = key;
      dirty.current = false;
      setDraft(null);
      base.current = null;
    }
    if (s.data && !dirty.current) {
      const plan = s.data.plan;
      base.current = plan?.revision ?? null;
      setDraft(
        plan
          ? {
              legId: plan.legId,
              seasonYear: plan.seasonYear,
              leadership: plan.leadership,
              managerWorkerId: plan.managerWorkerId,
              managerName: plan.managerName,
              workerIds: plan.workerIds,
              baseAddress: plan.baseAddress,
              transportResourceIds: plan.transportResourceIds,
            }
          : {
              legId,
              seasonYear,
              leadership: "unfilled",
              managerWorkerId: null,
              managerName: null,
              workerIds: [],
              baseAddress: null,
              transportResourceIds: [],
            },
      );
    }
  }, [key, s.data, legId, seasonYear]);
  const d =
      draft?.legId === legId && draft.seasonYear === seasonYear ? draft : null,
    c = s.data?.catalog;
  if (!d || !c?.enabled) return s.error ? <p role="alert">{s.error}</p> : null;
  const edit = (patch: Partial<LegSeasonPlanInput>) => {
    dirty.current = true;
    setDraft({ ...d, ...patch });
  };
  return (
    <section
      className="grid min-w-0 gap-3 rounded-xl border p-3"
      aria-label={`Season ${seasonYear} staffing`}
    >
      <h3 className="font-bold">{seasonYear} staffing &amp; base</h3>
      <p className="text-sm">
        Season assignments do not establish dated availability.
      </p>
      {s.error ? (
        <p role="alert">{s.error} Your entries are retained.</p>
      ) : null}
      <fieldset disabled={s.busy} className="grid gap-2">
        <Field label="Leadership">
          <select
            className={inputClass}
            value={d.leadership}
            onChange={(e) =>
              edit({ leadership: e.target.value as typeof d.leadership })
            }
          >
            <option value="unfilled">Unfilled</option>
            <option value="tentative">Tentative</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </Field>
        <Field label="Responsible manager name">
          <input
            className={inputClass}
            value={d.managerName ?? ""}
            onChange={(e) => edit({ managerName: e.target.value || null })}
          />
        </Field>
        <Field label="Responsible manager worker">
          <select
            className={inputClass}
            value={d.managerWorkerId ?? ""}
            onChange={(e) => edit({ managerWorkerId: e.target.value || null })}
          >
            <option value="">No worker identity linked</option>
            {c.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Choices
          label="Season crew"
          items={c.workers}
          selected={d.workerIds}
          onChange={(workerIds) => edit({ workerIds })}
        />
        <Field label="Verified season base address">
          <input
            className={inputClass}
            value={d.baseAddress ?? ""}
            onChange={(e) => edit({ baseAddress: e.target.value || null })}
          />
        </Field>
        <Choices
          label="Season vehicles & campers"
          items={c.resources.map((r) => ({
            id: r.id,
            name: `${r.name} · ${r.status}`,
          }))}
          selected={d.transportResourceIds}
          onChange={(transportResourceIds) => edit({ transportResourceIds })}
        />
        <button
          type="button"
          className="button-primary justify-self-start"
          onClick={() =>
            void s.run(async () => {
              const payload = legSeasonPlanInputSchema.parse(d);
              const result = await client.write(
                `/leg-seasons/${legId}/${seasonYear}`,
                {
                  payload,
                  expectedRevision: base.current,
                  requestKey: requestKey(),
                },
                "PATCH",
              );
              if (identity.current === key) dirty.current = false;
              return result;
            })
          }
        >
          Save season plan
        </button>
        <button
          type="button"
          onClick={() => {
            dirty.current = false;
            void s.reload();
          }}
        >
          Discard edits and reread season
        </button>
      </fieldset>
    </section>
  );
}
export function CrewAvailabilityEditor({
  role,
  client: override,
}: {
  role: PlanningRole;
  client?: PlanningClient;
}) {
  const client = usePlanningClient(role, override),
    s = usePlanningSetup(`availability:${role}`, client, () =>
      client.catalog(),
    ),
    [revision, setRevision] = useState<number | null>(null),
    [d, setDraft] = useState<CrewAvailabilityInput>({
      id: null,
      workerId: "",
      window: emptyWindow(),
      state: "unverified",
      source: {
        label: "",
        href: role === "owner" ? "/manager-crew" : `/${role}/crew`,
      },
    });
  const c = s.data;
  if (!c?.enabled) return null;
  const edit = (patch: Partial<CrewAvailabilityInput>) =>
    setDraft({ ...d, ...patch });
  return (
    <section
      aria-label="Worker availability"
      className="mt-3 grid min-w-0 gap-3 rounded-xl border p-3"
    >
      <h3 className="font-bold">Dated worker availability</h3>
      <p className="text-sm">
        Record direct confirmation or unavailability. Past work and rehire
        eligibility do not confirm these dates.
      </p>
      {s.error ? <p role="alert">{s.error}</p> : null}
      <Field label="Availability record">
        <select
          className={inputClass}
          value={d.id ?? ""}
          onChange={(e) => {
            const row = c.availability.find((a) => a.id === e.target.value);
            setRevision(row?.revision ?? null);
            setDraft(
              row
                ? {
                    id: row.id,
                    workerId: row.workerId,
                    window: row.window,
                    state: row.state,
                    source: row.source,
                  }
                : {
                    id: null,
                    workerId: "",
                    window: emptyWindow(),
                    state: "unverified",
                    source: {
                      label: "",
                      href:
                        role === "owner" ? "/manager-crew" : `/${role}/crew`,
                    },
                  },
            );
          }}
        >
          <option value="">New dated availability</option>
          {c.availability.map((a) => (
            <option key={a.id} value={a.id}>
              {c.workers.find((w) => w.id === a.workerId)?.name ??
                "Recorded worker"}{" "}
              · {a.state} · {a.window.startsAt} to {a.window.endsAt}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Availability worker">
        <select
          className={inputClass}
          value={d.workerId}
          onChange={(e) => edit({ workerId: e.target.value })}
        >
          <option value="">Choose a recorded worker</option>
          {c.workers.map((w) => (
            <option value={w.id} key={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <WindowFields
        label="Availability"
        value={d.window}
        onChange={(window) => edit({ window })}
      />
      <Field label="Availability state">
        <select
          className={inputClass}
          value={d.state}
          onChange={(e) => edit({ state: e.target.value as typeof d.state })}
        >
          <option value="unverified">Unverified</option>
          <option value="confirmed">Confirmed available</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </Field>
      <Field label="Availability evidence">
        <input
          className={inputClass}
          value={d.source.label}
          onChange={(e) =>
            edit({ source: { label: e.target.value, href: d.source.href } })
          }
        />
      </Field>
      <button
        type="button"
        disabled={s.busy}
        className="button-primary justify-self-start"
        onClick={() =>
          void s.run(async () => {
            const payload = crewAvailabilityInputSchema.parse(d);
            const result = await client.write<{ id: string; revision: number }>(
              `/crew-availability${d.id ? `/${d.id}` : ""}`,
              { payload, expectedRevision: revision, requestKey: requestKey() },
              d.id ? "PATCH" : "POST",
            );
            setDraft({ ...d, id: result.value.id });
            setRevision(result.value.revision);
            return result;
          })
        }
      >
        Save dated availability
      </button>
    </section>
  );
}
