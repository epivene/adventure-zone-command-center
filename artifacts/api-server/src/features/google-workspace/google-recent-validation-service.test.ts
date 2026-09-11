import { describe, expect, it, vi } from "vitest";

import { GoogleRecentValidationService } from "./google-recent-validation-service";
import type { GoogleWorkspaceReadClient } from "./google-api-types";

const message = (id: string, from: string, subject: string, labelIds: string[]) => ({
  id,
  threadId: `thread-${id}`,
  labelIds,
  internalDateMs: 1787510000000,
  snippet: subject,
  headers: { from, to: "zone@example.com", cc: "", subject, date: "" },
  hasAttachments: false,
});

function validationRepository(
  upsertRows = vi.fn(async () => undefined),
  upsertReviewItems = vi.fn(async () => undefined),
  processedMessageIds = vi.fn(async () => new Set<string>()),
) {
  return {
    upsertRows,
    upsertReviewItems,
    processedMessageIds,
    getStatus: vi.fn(async () => "ready_for_review" as const),
  };
}

describe("GoogleRecentValidationService", () => {
  it.each(["Profiles", "Z - AdventureZone/Profiles"])("matches membership mail using its approved %s label", async (root) => {
    const target = { id: "wfa", name: "ASSOC - WFA Western Fairs Association" };
    const label = { id: "Label_wfa", name: `${root}/${target.name}`, type: "user" as const };
    const repository = validationRepository();
    const client = {
      accountIdentity: async () => ({ email: "zone@example.com" }),
      listLabels: async () => [label],
      listRecentMessageRefs: async () => [{ id: "membership", threadId: "thread-membership" }],
      getMessageMetadata: async () => message("membership", "zone@example.com", "The Adventure Zone Membership", ["SENT", label.id]),
    } as unknown as GoogleWorkspaceReadClient;
    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [{...label,rootId:"root",rootName:root}], calendars: [] }) },
      evidence: { load: async () => ({ contacts: [], organizations: [], profiles: [target, {id:"internal",name:"Adventure Zone"}] }) },
      validationRepository: repository,
    });
    const result = await service.run();
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].resolvedOrganization).toEqual(target);
    expect(result.matched[0].evidenceCodes).toContain("exact_profile_label");
    expect(repository.upsertRows).toHaveBeenCalledWith([expect.objectContaining({organizationId:"wfa"})]);
  });

  it("keeps a label/thread disagreement for review even when the body names a single profile", async () => {
    const target = {id:"correct",name:"Clearfield Celebration"};
    const other = {id:"wrong",name:"Mandan Celebration"};
    const label = {id:"label",name:`Profiles/${target.name}`,type:"user" as const};
    const repository = validationRepository();
    const client = {
      accountIdentity: async () => ({email:"zone@example.com"}),
      listLabels: async () => [label],
      listRecentMessageRefs: async () => [{id:"m1",threadId:"thread-m1"}],
      getMessageMetadata: async () => message("m1","x@example.org",other.name,[label.id]),
      getThreadDetail: async () => ({messages:[{bodyText:other.name}]}),
    } as unknown as GoogleWorkspaceReadClient;
    const service = new GoogleRecentValidationService({
      connection:{createReadClient:async()=>client},
      scope:{getSaved:async()=>({labels:[{...label,rootId:"root",rootName:"Profiles"}],calendars:[]})},
      evidence:{load:async()=>({contacts:[],organizations:[],profiles:[target,other]})},
      learning:{load:async()=>({mailboxEmails:new Set<string>(),addressTargets:new Map(),threadTargets:new Map([["thread-m1",other]])})},
      validationRepository:repository,
    });
    const result = await service.run();
    expect(result.matched).toHaveLength(0);
    expect(result.needsReview).toHaveLength(1);
    expect(result.needsReview[0].evidenceCodes).toContain("profile_label_conflict");
    expect(result.needsReview[0].resolvedOrganization).toBeNull();
    expect(repository.upsertRows).toHaveBeenCalledWith([]);
  });
  it("does not reload metadata for messages already mapped or reviewed", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: async () => [
        { id: "processed", threadId: "thread-processed" },
        { id: "new", threadId: "thread-new" },
      ],
      getMessageMetadata: vi.fn(async (id) => {
        if (id === "processed") throw new Error("processed message was reread");
        return message(id, "booking@fair.org", "Hello", ["INBOX"]);
      }),
    };
    const processedMessageIds = vi.fn(async () => new Set(["processed"]));
    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
          organizations: [],
          profiles: [],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "c1",
          status: "resolved" as const,
          organization: { id: "org-1", name: "County Fair" },
          candidates: [{ id: "org-1", name: "County Fair" }],
        }),
      },
      validationRepository: validationRepository(
        vi.fn(async () => undefined),
        vi.fn(async () => undefined),
        processedMessageIds,
      ),
    });

    const result = await service.run(100, { skipProcessed: true });

    expect(processedMessageIds).toHaveBeenCalledWith(["processed", "new"]);
    expect(client.getMessageMetadata).toHaveBeenCalledTimes(1);
    expect(result.counts).toEqual({ discovered: 2, matched: 1, needsReview: 0, ignored: 0 });
  });

  it("resolves an exact contact match onward to its one active organization profile and persists the mapping", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: vi.fn(async () => [
        { id: "m1", threadId: "thread-m1" },
      ]),
      getMessageMetadata: vi.fn(async (id) =>
        message(id, "booking@fair.org", "Hello", ["INBOX"]),
      ),
    };
    const upsertRows = vi.fn(async () => undefined);
    const archiveApprovedThread = vi.fn(async () => undefined);

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
          organizations: [],
          profiles: [],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "c1",
          status: "resolved" as const,
          organization: { id: "org-1", name: "County Fair" },
          candidates: [{ id: "org-1", name: "County Fair" }],
        }),
      },
      validationRepository: validationRepository(upsertRows),
      archiver: { archiveApprovedThread },
    });

    const result = await service.run(100);

    expect(result.validationStatus).toBe("ready_for_review");
    expect(result.counts).toEqual({ discovered: 1, matched: 1, needsReview: 0, ignored: 0 });
    expect(result.matched[0]).toMatchObject({
      id: "m1",
      matchedContact: { id: "c1", name: "Fair Office" },
      resolvedOrganization: { id: "org-1", name: "County Fair" },
      evidenceCodes: ["exact_contact_email", "contact_active_organization"],
    });
    expect(upsertRows).toHaveBeenCalledWith([
      {
        messageId: "m1",
        threadId: "thread-m1",
        organizationId: "org-1",
        contactId: "c1",
        evidenceCodes: ["exact_contact_email", "contact_active_organization"],
      },
    ]);
    expect(archiveApprovedThread).toHaveBeenCalledWith({
      organizationId: "org-1",
      contactId: "c1",
      gmailThreadId: "thread-m1",
    });
  });

  it("moves an exact contact match to review when the contact belongs to multiple active profiles and persists the review item", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: async () => [{ id: "m1", threadId: "thread-m1" }],
      getMessageMetadata: async (id) => message(id, "booking@fair.org", "Hello", ["INBOX"]),
    };
    const upsertReviewItems = vi.fn(async () => undefined);

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
          organizations: [],
          profiles: [],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "c1",
          status: "ambiguous" as const,
          organization: null,
          candidates: [
            { id: "org-1", name: "County Fair" },
            { id: "org-2", name: "Summer Festival" },
          ],
        }),
      },
      validationRepository: validationRepository(vi.fn(async () => undefined), upsertReviewItems),
    });

    const result = await service.run(100);

    expect(result.counts).toEqual({ discovered: 1, matched: 0, needsReview: 1, ignored: 0 });
    expect(result.needsReview[0]).toMatchObject({
      matchedContact: { id: "c1", name: "Fair Office" },
      resolvedOrganization: null,
      organizationCandidates: [
        { id: "org-1", name: "County Fair" },
        { id: "org-2", name: "Summer Festival" },
      ],
      evidenceCodes: ["exact_contact_email", "contact_organization_ambiguous"],
    });
    expect(upsertReviewItems).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: "m1",
        threadId: "thread-m1",
        candidates: [
          { id: "org-1", name: "County Fair" },
          { id: "org-2", name: "Summer Festival" },
        ],
      }),
    ]);
  });

  it("matches a unique full profile name in the subject and ignores unrelated metadata", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: vi.fn(async () => [
        { id: "m2", threadId: "thread-m2" },
        { id: "m3", threadId: "thread-m3" },
      ]),
      getMessageMetadata: vi.fn(async (id) => {
        if (id === "m2") return message(id, "random@gmail.com", "Known Festival vendor info", ["INBOX"]);
        return message(id, "friend@gmail.com", "Dinner plans", ["INBOX"]);
      }),
    };

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: {
        getSaved: async () => ({
          labels: [{ id: "Label_Shows", name: "Shows", rootId: "Label_Shows", rootName: "Shows" }],
          calendars: [],
        }),
      },
      evidence: {
        load: async () => ({
          contacts: [],
          organizations: [],
          profiles: [{ id: "p1", name: "Known Festival" }],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "unused",
          status: "unresolved" as const,
          organization: null,
          candidates: [],
        }),
      },
      validationRepository: validationRepository(),
    });

    const result = await service.run(100);

    expect(client.listRecentMessageRefs).toHaveBeenCalledWith(100);
    expect(result.counts).toEqual({ discovered: 2, matched: 1, needsReview: 0, ignored: 1 });
    expect(result.matched[0]).toMatchObject({
      id: "m2",
      evidenceCodes: ["exact_profile_name_subject"],
      resolvedOrganization: { id: "p1", name: "Known Festival" },
    });
    expect(result.ignored[0]).toMatchObject({ id: "m3", subject: "Dinner plans" });
    expect(JSON.stringify(result)).not.toContain("body");
  });

  it("uses the connected mailbox identity when Gmail labels do not expose direction", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: async () => [{ id: "promo", threadId: "thread-promo" }],
      getMessageMetadata: async () =>
        message("promo", "Traeger <offers@traeger.com>", "We Built a Better Griddle", [
          "CATEGORY_PROMOTIONS",
          "UNREAD",
        ]),
    };
    const resolve = vi.fn();

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [{ id: "david", name: "David Gordon", emails: ["zone@example.com"] }],
          organizations: [],
          profiles: [],
        }),
      },
      contactProfileResolver: { resolve },
      validationRepository: validationRepository(),
    });

    const result = await service.run(100);

    expect(result.counts).toEqual({ discovered: 1, matched: 0, needsReview: 0, ignored: 1 });
    expect(result.ignored[0]).toMatchObject({ id: "promo" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("labels a later Inbox reply only after its inherited CRM mapping is saved", async () => {
    const order: string[] = [];
    const inboundLabeler = {
      labelNewThreadMatches: vi.fn(async () => { order.push("label"); }),
    };
    const repository = validationRepository(
      vi.fn(async () => { order.push("mapping"); }),
    );
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: async () => [{
        id: "new-reply",
        threadId: "known-thread",
      }],
      getMessageMetadata: async () => ({
        ...message("new-reply", "fair@example.org", "Re: County Fair", ["INBOX", "UNREAD"]),
        threadId: "known-thread",
      }),
    };
    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({ contacts: [], organizations: [], profiles: [] }),
      },
      learning: {
        load: async () => ({
          mailboxEmails: new Set(["zone@example.com"]),
          threadTargets: new Map([[
            "known-thread",
            { id: "org-1", name: "County Fair" },
          ]]),
          addressTargets: new Map(),
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "unused",
          status: "unresolved" as const,
          organization: null,
          candidates: [],
        }),
      },
      validationRepository: repository,
      inboundLabeler,
    });

    await service.run(100);

    expect(order).toEqual(["mapping", "label"]);
    expect(inboundLabeler.labelNewThreadMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "new-reply",
        threadId: "known-thread",
        labelIds: ["INBOX", "UNREAD"],
        evidenceCodes: expect.arrayContaining(["existing_thread_association"]),
        resolvedOrganization: { id: "org-1", name: "County Fair" },
      }),
    ]);
  });

  it("fails closed when the connected Google client does not support Gmail metadata validation", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
    };
    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: { load: async () => ({ contacts: [], organizations: [], profiles: [] }) },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "unused",
          status: "unresolved" as const,
          organization: null,
          candidates: [],
        }),
      },
      validationRepository: validationRepository(),
    });

    await expect(service.run(100)).rejects.toThrow("GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE");
  });
});
