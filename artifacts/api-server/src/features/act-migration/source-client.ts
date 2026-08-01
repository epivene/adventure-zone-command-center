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
    expand:
      "contacts($select=id,fullName);companies($select=id,name);opportunities($select=id,name)",
  },
  note: {
    select: "id,subject,body,createDate,edited",
    expand:
      "contact($select=id,fullName);company($select=id,name);opportunity($select=id,name)",
  },
  history: {
    select: "id,subject,details,createDate,edited",
    expand:
      "contact($select=id,fullName);company($select=id,name);opportunity($select=id,name)",
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
  // Per-record relationship endpoints — used as fallback when plain-mode
  // responses omit inline expansions.
  listContactsForNote(noteId: string, request: ActPageRequest): Promise<ActPage>;
  listCompaniesForNote(noteId: string, request: ActPageRequest): Promise<ActPage>;
  listContactsForHistory(historyId: string, request: ActPageRequest): Promise<ActPage>;
  listCompaniesForHistory(historyId: string, request: ActPageRequest): Promise<ActPage>;
  listContactsForActivity(activityId: string, request: ActPageRequest): Promise<ActPage>;
  listCompaniesForActivity(activityId: string, request: ActPageRequest): Promise<ActPage>;
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

  listContactsForNote(noteId: string, request: ActPageRequest) {
    return this.list(`/api/notes/${encodeURIComponent(noteId)}/contacts`, "contact", request);
  }

  listCompaniesForNote(noteId: string, request: ActPageRequest) {
    return this.list(`/api/notes/${encodeURIComponent(noteId)}/companies`, "company", request);
  }

  listContactsForHistory(historyId: string, request: ActPageRequest) {
    return this.list(`/api/history/${encodeURIComponent(historyId)}/contacts`, "contact", request);
  }

  listCompaniesForHistory(historyId: string, request: ActPageRequest) {
    return this.list(`/api/history/${encodeURIComponent(historyId)}/companies`, "company", request);
  }

  listContactsForActivity(activityId: string, request: ActPageRequest) {
    return this.list(`/api/activities/${encodeURIComponent(activityId)}/contacts`, "contact", request);
  }

  listCompaniesForActivity(activityId: string, request: ActPageRequest) {
    return this.list(`/api/activities/${encodeURIComponent(activityId)}/companies`, "company", request);
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
    }
    // Always include a stable sort key so offset-based pagination is deterministic
    // in both projected and plain mode. Without this, concurrent source changes or
    // Act!'s internal ordering can cause records to shift between pages, resulting
    // in skipped or duplicate items.
    query.$orderby = "id";
    query.$skip = String(request.skip);
    query.$top = String(request.top);
    if (request.filter) {
      query.$filter = request.filter;
    }

    // In projected mode we try the richer $select/$expand form first. The Act!
    // API signals "projections not supported" in two distinct ways:
    //  (a) Returns an empty page on the very first request — existing behaviour.
    //  (b) Throws an HTTP error (4xx/5xx) because the endpoint does not support
    //      $select or $expand at all.
    // Both cases are treated identically: return the plain-fallback sentinel so
    // the caller retries the same page position in un-projected plain mode.
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.requestJson({
        path,
        method: "GET",
        query,
      });
    } catch (err) {
      if (request.queryMode === "projected" && request.skip === 0) {
        // Projection rejected by the endpoint — fall back to plain mode.
        return { items: [], nextSkip: request.skip, queryMode: "plain" };
      }
      throw err;
    }

    const items = pageItems(rawResponse);
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
