import type { OrganizationListPage, OrganizationListRecord, OrganizationListQuery } from "@/features/organizations/organization-repository";

export type ProfileDirectoryView = "all" | "events" | "organizations" | "contacts";

export function profileTypesForDirectoryView(view: ProfileDirectoryView): string[] {
  if (view === "events") return ["fair", "festival_event"];
  if (view === "organizations") return ["city_government", "venue", "school", "tribe", "association", "company", "other"];
  return [];
}

function commonQueryParams(query: OrganizationListQuery) {
  const qs = new URLSearchParams();
  if (query.search) qs.set("q", query.search);
  if (query.lastResort !== "all") qs.set("lastResort", query.lastResort);
  if (query.travelLegId) qs.set("leg", query.travelLegId);
  if (query.region) qs.set("region", query.region);
  if (query.hasPhone) qs.set("hasPhone", "yes");
  if (query.hasEmail) qs.set("hasEmail", "yes");
  if (query.hasFollowUp) qs.set("hasFollowUp", "yes");
  if (query.hasBooking) qs.set("hasBooking", "yes");
  if (query.hasLocations) qs.set("hasLocations", "yes");
  if (query.showMembers) qs.set("showMembers", "yes");
  if (query.includeRetired) qs.set("includeRetired", "true");
  return qs;
}

function recordOrder(search: string) {
  const normalized = search.trim().toLowerCase();
  return (left: OrganizationListRecord, right: OrganizationListRecord) => {
    if (normalized) {
      const leftExact = left.name.trim().toLowerCase() === normalized;
      const rightExact = right.name.trim().toLowerCase() === normalized;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "en-US") || left.id.localeCompare(right.id);
  };
}

type ApiDirectoryResponse = {
  organizations: OrganizationListPage;
  families?: any[];
  travelLegs?: any[];
};

export async function loadProfileDirectoryBucket(input: {
  view: "events" | "organizations";
  query: OrganizationListQuery;
  fetchPage(path: string): Promise<ApiDirectoryResponse>;
}) {
  const allowedTypes = profileTypesForDirectoryView(input.view);
  const types = input.query.placeType
    ? allowedTypes.includes(input.query.placeType) ? [input.query.placeType] : []
    : allowedTypes;
  const perPage = input.query.pageSize;
  const requiredThrough = input.query.page * perPage;
  const base = commonQueryParams(input.query);

  if (!types.length) {
    return {
      organizations: { records: [], total: 0, page: input.query.page, pageSize: perPage, pageCount: 1 },
      families: [],
      travelLegs: [],
    };
  }

  const firstPages = await Promise.all(types.map(async (type) => {
    const qs = new URLSearchParams(base);
    qs.set("type", type);
    qs.set("pageSize", String(perPage));
    const response = await input.fetchPage(`/organizations?${qs.toString()}`);
    return { type, response };
  }));

  const additionalRequests: Array<Promise<{ type: string; response: ApiDirectoryResponse }>> = [];
  for (const item of firstPages) {
    const pageCountNeeded = Math.min(
      item.response.organizations.pageCount,
      Math.ceil(Math.min(item.response.organizations.total, requiredThrough) / perPage),
    );
    for (let page = 2; page <= pageCountNeeded; page += 1) {
      const qs = new URLSearchParams(base);
      qs.set("type", item.type);
      qs.set("page", String(page));
      qs.set("pageSize", String(perPage));
      additionalRequests.push(input.fetchPage(`/organizations?${qs.toString()}`).then((response) => ({ type: item.type, response })));
    }
  }
  const additional = await Promise.all(additionalRequests);
  const allResponses = [...firstPages, ...additional];
  const records = allResponses.flatMap((item) => item.response.organizations.records).toSorted(recordOrder(input.query.search));
  const total = firstPages.reduce((sum, item) => sum + item.response.organizations.total, 0);
  const start = (input.query.page - 1) * perPage;
  const organizations: OrganizationListPage = {
    records: records.slice(start, start + perPage),
    total,
    page: input.query.page,
    pageSize: perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
  const families = [...new Map(allResponses.flatMap((item) => item.response.families ?? []).map((family: any) => [family.id, family])).values()];
  const travelLegs = firstPages.find((item) => item.response.travelLegs?.length)?.response.travelLegs ?? [];
  return { organizations, families, travelLegs };
}
