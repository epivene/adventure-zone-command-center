import { useState } from "react";
import {
  packageSetInputSchema,
  type PackageSetInput,
  type PackageSet,
  type DaveAuthority,
} from "@workspace/api-zod";
import {
  requestKey,
  usePlanningClient,
  type PlanningClient,
  type PlanningRole,
} from "@/features/leg-planning/planning-client";
import { Choices, Field, inputClass } from "./planning-fields";
import { usePlanningSetup } from "./use-planning-setup";
const blank = (): PackageSetInput => ({
  id: null,
  packageId: "",
  name: "",
  classification: "normal",
  resourceIds: [],
  requirements: {},
  verify: false,
  source: null,
});
export function PackageSetEditor(props: {
  role: PlanningRole;
  client?: PlanningClient;
}) {
  return props.role === "owner" ? <OwnerPackageSetEditor {...props} /> : null;
}
function OwnerPackageSetEditor({
  role,
  client: override,
}: {
  role: PlanningRole;
  client?: PlanningClient;
}) {
  const client = usePlanningClient(role, override),
    s = usePlanningSetup("physical-sets", client, () => client.catalog()),
    [d, setDraft] = useState(blank),
    [revision, setRevision] = useState<number | null>(null),
    [categories, setCategories] = useState<{ name: string; count: number }[]>(
      [],
    );
  const c = s.data;
  if (!c?.enabled) return null;
  const edit = (p: Partial<PackageSetInput>) => setDraft({ ...d, ...p });
  return (
    <section
      aria-label="Physical package sets"
      className="grid min-w-0 gap-3 rounded-xl border p-4"
    >
      <h2 className="text-lg font-bold">Physical package sets</h2>
      <p className="text-sm">
        Use actual equipment records. Normal limits are five Adventure Zone,
        three Pirates and one Warrior. An extra set still needs Dave's dated
        approval.
      </p>
      {s.error ? (
        <p role="alert">{s.error} Your entries are retained.</p>
      ) : null}
      <Field label="Existing physical set">
        <select
          className={inputClass}
          value={d.id ?? ""}
          onChange={(e) => {
            const row = c.packageSets.find((p) => p.id === e.target.value);
            setRevision(row?.revision ?? null);
            setCategories(
              Object.entries(row?.requirements ?? {}).map(([name, count]) => ({
                name,
                count,
              })),
            );
            setDraft(
              row
                ? {
                    id: row.id,
                    packageId: row.packageId,
                    name: row.name,
                    classification: row.classification,
                    resourceIds: row.resourceIds,
                    requirements: row.requirements,
                    verify: row.state === "verified",
                    source: row.source,
                  }
                : blank(),
            );
          }}
        >
          <option value="">Create a physical set</option>
          {c.packageSets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.state} · {p.classification}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Physical set name">
        <input
          className={inputClass}
          value={d.name}
          onChange={(e) => edit({ name: e.target.value })}
        />
      </Field>
      <Field label="Package">
        <select
          className={inputClass}
          value={d.packageId}
          onChange={(e) => edit({ packageId: e.target.value })}
        >
          <option value="">Choose package</option>
          {c.packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Set classification">
        <select
          className={inputClass}
          value={d.classification}
          onChange={(e) =>
            edit({ classification: e.target.value as typeof d.classification })
          }
        >
          <option value="normal">Normal physical set</option>
          <option value="extra">
            Extra physical set requiring Dave approval
          </option>
        </select>
      </Field>
      <Choices
        label="Actual composition"
        items={c.resources.map((r) => ({
          id: r.id,
          name: `${r.name} · ${r.status}`,
        }))}
        selected={d.resourceIds}
        onChange={(resourceIds) => edit({ resourceIds })}
      />
      <fieldset className="grid gap-2">
        <legend className="font-semibold">Required composition</legend>
        {categories.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-3">
            <Field label={`Required category ${i + 1}`}>
              <input
                className={inputClass}
                value={r.name}
                list="physical-resource-categories"
                onChange={(e) =>
                  setCategories(
                    categories.map((v, n) =>
                      n === i ? { ...v, name: e.target.value } : v,
                    ),
                  )
                }
              />
            </Field>
            <Field label={`Required count ${i + 1}`}>
              <input
                className={inputClass}
                type="number"
                min="1"
                value={r.count}
                onChange={(e) =>
                  setCategories(
                    categories.map((v, n) =>
                      n === i ? { ...v, count: Number(e.target.value) } : v,
                    ),
                  )
                }
              />
            </Field>
            <button
              type="button"
              onClick={() =>
                setCategories(categories.filter((_, n) => n !== i))
              }
            >
              Remove category {i + 1}
            </button>
          </div>
        ))}
        <datalist id="physical-resource-categories">
          {[...new Set(c.resources.map((r) => r.category))].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => setCategories([...categories, { name: "", count: 1 }])}
        >
          Add required category
        </button>
      </fieldset>
      <Field label="Verification source">
        <input
          className={inputClass}
          value={d.source?.label ?? ""}
          onChange={(e) =>
            edit({
              source: e.target.value
                ? {
                    label: e.target.value,
                    href: "/settings/packages-resources",
                  }
                : null,
            })
          }
        />
      </Field>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={d.verify}
          onChange={(e) => edit({ verify: e.target.checked })}
        />
        Verify complete physical composition
      </label>
      <button
        type="button"
        className="button-primary justify-self-start"
        disabled={s.busy}
        onClick={() =>
          void s.run(async () => {
            if (
              categories.some((x) => !x.name.trim()) ||
              new Set(categories.map((x) => x.name.trim())).size !==
                categories.length
            )
              throw new Error("Enter each required category once.");
            const payload = packageSetInputSchema.parse({
              ...d,
              requirements: Object.fromEntries(
                categories.map((x) => [x.name.trim(), x.count]),
              ),
            });
            const result = await client.write<PackageSet>(
              `/package-sets${d.id ? `/${d.id}` : ""}`,
              { payload, expectedRevision: revision, requestKey: requestKey() },
              d.id ? "PATCH" : "POST",
            );
            setDraft({ ...payload, id: result.value.id });
            setRevision(result.value.revision);
            return result;
          })
        }
      >
        Save physical set
      </button>
    </section>
  );
}
export function DaveAuthorityEditor() {
  const client = usePlanningClient("owner"),
    s = usePlanningSetup("dave-authority", client, async () => ({
      catalog: await client.catalog(),
      authority: await client.get<DaveAuthority | null>(
        "/leg-planning/dave-authority",
      ),
    })),
    [account, setAccount] = useState<string | null>(null),
    [editRevision, setEditRevision] = useState<number | null>(null);
  if (!s.data?.catalog.enabled) return null;
  return (
    <section className="grid gap-3 rounded-xl border p-4">
      <h3 className="font-bold">Dave's approval account</h3>
      <p className="text-sm">
        Bind the actual enabled boss account Dave uses. A display name does not
        grant approval authority.
      </p>
      {s.error ? <p role="alert">{s.error}</p> : null}
      <Field label="Dave approval account">
        <select
          className={inputClass}
          value={account ?? s.data.authority?.accountId ?? ""}
          disabled={s.busy}
          onChange={(e) => {
            if (account === null)
              setEditRevision(s.data!.authority?.revision ?? null);
            setAccount(e.target.value);
          }}
        >
          <option value="">No approval authority</option>
          {s.data.catalog.bossAccounts?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="button"
        className="button-primary justify-self-start"
        disabled={s.busy}
        onClick={() =>
          void s.run(async () => {
            const result = await client.write<DaveAuthority>(
              "/leg-planning/dave-authority",
              {
                payload: {
                  accountId: (account ?? s.data!.authority?.accountId) || null,
                },
                expectedRevision:
                  account === null
                    ? (s.data!.authority?.revision ?? null)
                    : editRevision,
                requestKey: requestKey(),
              },
              "PATCH",
            );
            setEditRevision(result.value.revision);
            setAccount(null);
            return result;
          })
        }
      >
        Save Dave authority
      </button>
    </section>
  );
}
