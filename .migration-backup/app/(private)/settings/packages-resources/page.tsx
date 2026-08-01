import {
  updatePackageTemplateAction,
  upsertResourceAction,
} from "@/app/(private)/settings/packages-resources/actions";
import { PackageTemplateEditor } from "@/components/packages/package-template-editor";
import { ResourceInventoryEditor } from "@/components/resources/resource-inventory-editor";
import { DrizzlePackageSettingsRepository } from "@/features/packages/package-repository";
import { DrizzleResourceSettingsRepository } from "@/features/resources/resource-repository";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

async function loadPackageResourceSettings() {
  await requireOwner();
  const { db } = await import("@/db/client");
  const packageRepository = new DrizzlePackageSettingsRepository(db);
  const resourceRepository = new DrizzleResourceSettingsRepository(db);
  const travelLegRepository = new DrizzleTravelLegRepository(db);
  const [packageTemplates, resources, currentTravelLegs] = await Promise.all([
    packageRepository.listPackageTemplates(),
    resourceRepository.listResources(),
    travelLegRepository.listTravelLegs(),
  ]);
  return {
    packageTemplates,
    resources,
    travelLegs: currentTravelLegs.map(({ id, name }) => ({
      id,
      name,
      archivedAt: null,
    })),
  };
}

export default async function PackageResourceSettingsPage() {
  const { packageTemplates, resources, travelLegs } =
    await loadPackageResourceSettings();

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Packages &amp; resources
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Maintain package labels and the physical inventory used for booking
          assignments. Deactivation and archiving preserve historical records.
        </p>
      </header>

      <PackageTemplateEditor
        onSubmit={updatePackageTemplateAction}
        templates={packageTemplates}
      />
      <ResourceInventoryEditor
        onSubmit={upsertResourceAction}
        packageTemplates={packageTemplates}
        resources={resources}
        travelLegs={travelLegs}
      />
    </div>
  );
}
