import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { PackageTemplateEditor } from "@/components/packages/package-template-editor";
import { ResourceInventoryEditor } from "@/components/resources/resource-inventory-editor";
import { updatePackageTemplateAction, upsertResourceAction } from "@/actions/settings";

export default function SettingsPackagesResourcesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    apiGet<any>("/settings/packages-resources")
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(reload, []);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Packages &amp; Resources</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Configure the show packages and equipment resources available for bookings.
        </p>
      </header>

      {loading ? (
        <p className="text-slate-500">Loading settings…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-rose-700">{error}</p>
        </div>
      ) : data ? (
        <div className="grid gap-6">
          <PackageTemplateEditor
            templates={data.packageTemplates ?? []}
            onSubmit={async (input) => {
              const res = await updatePackageTemplateAction(input);
              if (res.ok) reload();
              return res;
            }}
          />
          <ResourceInventoryEditor
            resources={data.resources ?? []}
            packageTemplates={data.packageTemplates ?? []}
            travelLegs={data.travelLegs ?? []}
            onSubmit={async (input) => {
              const res = await upsertResourceAction(input);
              if (res.ok) reload();
              return res;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
