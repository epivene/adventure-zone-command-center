import { OrganizationList } from "@/components/organizations/organization-list";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const raw = await searchParams;
  const query = organizationListQuerySchema.parse({
    q: firstValue(raw.q),
    lastResort: firstValue(raw.lastResort),
    leg: firstValue(raw.leg),
    page: firstValue(raw.page),
    pageSize: firstValue(raw.pageSize),
  });
  const { db } = await import("@/db/client");
  const repository = new DrizzleOrganizationRepository(db);
  const [organizations, travelLegs] = await Promise.all([
    repository.listOrganizations(query),
    repository.listTravelLegs(),
  ]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Relationships
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Places</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Find a fair, city, venue, or company and the contacts you can call there. Each place keeps its contacts and booking opportunities together.
        </p>
      </header>
      <OrganizationList organizations={organizations} query={query} travelLegs={travelLegs} />
    </div>
  );
}
