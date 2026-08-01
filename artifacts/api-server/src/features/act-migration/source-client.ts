import { ActApiError } from "@/features/act-sync/act-errors";
import type {
  ActPage,
  ActPageRequest,
} from "@/features/act-migration/migration-types";
import type { ActTransport } from "@/features/act-sync/act-types";

const sourceQueries = {
  company: {
    select: "id,name,phone,website,industry,edited",
    expand: "address($select=line1,line2,city,state,postalCode)",
  },
  contact: {
    select:
      "id,firstName,lastName,fullName,company,jobTitle,emailAddress,businessPhone,edited",
    expand:
      "businessAddress($select=line1,line2,city,state,postalCode)",
  },
  opportunity: {
    select:
      "id,name,status,estimatedCloseDate,actualCloseDate,total,probability,edited",
    expand:
      "stage($expand=process($select=name,id);$select=name,id)",
  },
  group: {
    select: "id,name,description,edited",
  },
  activity: {
    select: "id,activityType,subject,scheduleDate,duration,details,edited",
    expand: "contacts($select=id,fullName);companies($select=id,name)",
  },
  note: {
    select: "id,subject,body,createDate,edited",
    expand: "contact($select=id,fullName);company($select=id,name)",
  },
  history: {
    select: "id,subject,details,createDate,edited",
    expand: "contact($select=id,fullName);company($select=id,name)",
  },
} as const;

type SourceEntity = keyof typeof sourceQueries;

export interface ActMigrationSourceClient {
  listCompanies(request: ActPageRequest): Promise<ActPage>;
  listContacts(request: ActPageRequest): Promise<ActPage>;
  listOpportunities(request: ActPageRequest): Promise<ActPage>;
  listGroups(request: ActPageRequest): Promise<ActPage>;
  listCompaniesForContact(
    contactId: string,
    request: ActPageRequest,
  ): Promise<ActPage>;
  listCompaniesForOpportunity(
    opportunityId: string,
    request: ActPageRequest,
  ): Promise<ActPage>;
  listContactsForOpportunity(
    opportunityId: string,
    request: ActPageRequest,
  ): Promise<ActPage>;
  listContactsForGroup(
    groupId: string,
    request: ActPageRequest,
  ): Promise<ActPage>;
  listActivities(request: ActPageRequest): Promise<ActPage>;
  listNotes(request: ActPageRequest): Promise<ActPage>;
  listHistory(request: ActPageRequest): Promise<ActPage>;
}

function pageItems(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrapped = (value as Record<string, unknown>).value;
    if (Array.isArray(wrapped)) return wrapped;
  }
  throw new ActApiError("invalid_response", false);
}

export class HttpActMigrationSourceClient
  implements ActMigrationSourceClient
{
  constructor(private readonly transport: ActTransport) {}

  listCompanies(request: ActPageRequest) {
    return this.list("/api/companies", "company", request);
  }

  listContacts(request: ActPageRequest) {
    return this.list("/api/contacts", "contact", request);
  }

  listOpportunities(request: ActPageRequest) {
    return this.list("/api/opportunities", "opportunity", request);
  }

  listGroups(request: ActPageRequest) {
    return this.list("/api/groups", "group", request);
  }

  listCompaniesForContact(contactId: string, request: ActPageRequest) {
    return this.list(
      `/api/contacts/${encodeURIComponent(contactId)}/companies`,
      "company",
      request,
    );
  }

  listCompaniesForOpportunity(
    opportunityId: string,
    request: ActPageRequest,
  ) {
    return this.list(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/companies`,
      "company",
      request,
    );
  }

  listContactsForOpportunity(
    opportunityId: string,
    request: ActPageRequest,
  ) {
    return this.list(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/contacts`,
      "contact",
      request,
    );
  }

  listContactsForGroup(groupId: string, request: ActPageRequest) {
    return this.list(
      `/api/groups/${encodeURIComponent(groupId)}/contacts`,
      "contact",
      request,
    );
  }

  listActivities(request: ActPageRequest) {
    return this.list("/api/activities", "activity", request);
  }

  listNotes(request: ActPageRequest) {
    return this.list("/api/notes", "note", request);
  }

  listHistory(request: ActPageRequest) {
    return this.list("/api/history", "history", request);
  }

  private async list(
    path: `/api/${string}`,
    entity: SourceEntity,
    request: ActPageRequest,
  ): Promise<ActPage> {
    const query: Record<string, string> = {};
    if (request.queryMode === "projected") {
      const projection = sourceQueries[entity];
      query.$select = projection.select;
      if ("expand" in projection) query.$expand = projection.expand;
      query.$orderby = "id";
    }
    query.$skip = String(request.skip);
    query.$top = String(request.top);
    if (request.filter) {
      query.$filter = request.filter;
    }

    const items = pageItems(
      await this.transport.requestJson({
        path,
        method: "GET",
        query,
      }),
    );
    if (
      items.length === 0 &&
      request.skip === 0 &&
      request.queryMode === "projected"
    ) {
      return {
        items,
        nextSkip: request.skip,
        queryMode: "plain",
      };
    }
    return {
      items,
      nextSkip: items.length === 0 ? null : request.skip + items.length,
      queryMode: request.queryMode,
    };
  }
}
