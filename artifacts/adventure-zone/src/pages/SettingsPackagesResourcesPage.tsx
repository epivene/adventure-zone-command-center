import { useEffect, useState } from "react";
import { PackageSetEditor, DaveAuthorityEditor } from '@/components/leg-planning/package-set-editor';
import { apiGet } from "@/lib/auth-token";
import { PackageTemplateEditor } from "@/components/packages/package-template-editor";
import { CommercialOfferEditor } from "@/components/packages/commercial-offer-editor";
import { ResourceInventoryEditor } from "@/components/resources/resource-inventory-editor";
import { ResourceSourceCandidateReview } from "@/components/resources/resource-source-candidate-review";
import { updatePackageTemplateAction, upsertResourceAction } from "@/actions/settings";

export const packageResourceSectionDefaults = {
  packageTemplatesOpen: true,
  offersOpen: false,
  resourceInventoryOpen: false,
  importedAssetsOpen: false,
} as const;

export default function SettingsPackagesResourcesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packageTemplatesOpen, setPackageTemplatesOpen] = useState<boolean>(
    packageResourceSectionDefaults.packageTemplatesOpen,
  );
  const [offersOpen, setOffersOpen] = useState<boolean>(packageResourceSectionDefaults.offersOpen);
  const [resourceInventoryOpen, setResourceInventoryOpen] = useState<boolean>(
    packageResourceSectionDefaults.resourceInventoryOpen,
  );
  const [importedAssetsOpen, setImportedAssetsOpen] = useState<boolean>(
    packageResourceSectionDefaults.importedAssetsOpen,
  );

  function reload() {
    apiGet<any>("/settings/packages-resources")
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(reload, []);

  function openNormalResourceForm() {
    setResourceInventoryOpen(true);
    window.setTimeout(() => {
      document.getElementById("resource-inventory-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Settings</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Packages &amp; Resources</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Configure packages, reviewed offers, and equipment resources available for bookings.</p>
      </header>

      {loading ? <p className="text-slate-500">Loading settings…</p> : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div>
      ) : data ? (
        <div className="grid gap-4">
          <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">Verified physical sets &amp; Dave approval setup</summary><div className="mt-3 grid gap-3"><PackageSetEditor role="owner"/><DaveAuthorityEditor/></div></details>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <button aria-expanded={packageTemplatesOpen} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5" onClick={() => setPackageTemplatesOpen((open) => !open)} type="button">
              <div><h2 className="text-xl font-bold">Package templates</h2><p className="mt-1 text-sm font-normal text-slate-600">Starting prices, package sizes, and booking/setup knowledge.</p></div>
              <span aria-hidden="true" className="text-xl text-slate-500">{packageTemplatesOpen ? "▴" : "▾"}</span>
            </button>
            {packageTemplatesOpen ? <div className="border-t border-slate-200 p-4 pt-4 sm:p-5"><PackageTemplateEditor templates={data.packageTemplates ?? []} onSubmit={async (input) => {const res=await updatePackageTemplateAction(input);if(res.ok)reload();return res;}} /></div> : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <button aria-expanded={offersOpen} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5" onClick={() => setOffersOpen((open) => !open)} type="button">
              <div><h2 className="text-xl font-bold">Offers &amp; Discounts</h2><p className="mt-1 text-sm font-normal text-slate-600">Owner-reviewed discounts, payment options, fees, deadlines, and eligibility.</p></div>
              <span aria-hidden="true" className="text-xl text-slate-500">{offersOpen ? "▴" : "▾"}</span>
            </button>
            {offersOpen ? <div className="border-t border-slate-200 p-4 pt-4 sm:p-5"><CommercialOfferEditor /></div> : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" id="resource-inventory-section">
            <button aria-expanded={resourceInventoryOpen} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5" onClick={() => setResourceInventoryOpen((open) => !open)} type="button">
              <div><h2 className="text-xl font-bold">Resource inventory</h2><p className="mt-1 text-sm font-normal text-slate-600">Equipment identity, package tags, safety tags, travel needs, timing, and availability.</p></div>
              <span aria-hidden="true" className="text-xl text-slate-500">{resourceInventoryOpen ? "▴" : "▾"}</span>
            </button>
            {resourceInventoryOpen ? <div className="border-t border-slate-200 p-4 pt-4 sm:p-5"><ResourceInventoryEditor resources={data.resources ?? []} packageTemplates={data.packageTemplates ?? []} travelLegs={data.travelLegs ?? []} onSubmit={async (input) => {const res=await upsertResourceAction(input);if(res.ok)reload();return res;}} /></div> : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <button aria-expanded={importedAssetsOpen} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5" onClick={() => setImportedAssetsOpen((open) => !open)} type="button">
              <div><h2 className="text-xl font-bold">Imported asset details</h2><p className="mt-1 text-sm font-normal text-slate-600">Review the nine identities from the inflatable asset source list and connect uncertain matches.</p></div>
              <span aria-hidden="true" className="text-xl text-slate-500">{importedAssetsOpen ? "▴" : "▾"}</span>
            </button>
            {importedAssetsOpen ? <div className="border-t border-slate-200 p-4 pt-4 sm:p-5"><ResourceSourceCandidateReview onCreateResource={openNormalResourceForm} /></div> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
