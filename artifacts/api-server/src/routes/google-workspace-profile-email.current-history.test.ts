import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createGoogleWorkspaceProfileEmailRouter } from "./google-workspace-profile-email";

function thread(threadId: string, year: number) {
  const internalDateMs = Date.UTC(year, 7, 25, 18, 0, 0);
  return {
    id: threadId,
    subject: `${year} Twin Falls County Fair`,
    originalGmailUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
    messages: [
      {
        id: `${threadId}-message`,
        internalDateMs,
        from: "Adventure Zone <theadventurezone12@gmail.com>",
        to: "fair@tfcfair.com",
        cc: "",
        subject: `${year} Twin Falls County Fair`,
        date: new Date(internalDateMs).toUTCString(),
        direction: "outgoing" as const,
        bodyText: "Hello",
        attachments: [],
      },
    ],
  };
}

describe("Google profile email current/history split", () => {
  it("returns current-year conversations in the main list and preserves older threads separately", async () => {
    const year = new Date().getUTCFullYear();
    const mappings = [
      { messageId: "current-message", threadId: "current-thread", organizationId: "org-1", contactId: null, evidenceCodes: ["exact_contact_email"] },
      { messageId: "older-message", threadId: "older-thread", organizationId: "org-1", contactId: null, evidenceCodes: ["historical_gmail_backfill"] },
    ];
    const app = express();
    app.use(createGoogleWorkspaceProfileEmailRouter({
      connection: {
        createReadClient: async () => ({
          authorizationUrl: () => "",
          exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
          accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
          listLabels: async () => [],
          listCalendars: async () => [],
          getMessageMetadata: async () => null as any,
          getThreadDetail: async (threadId: string) => thread(threadId, threadId === "current-thread" ? year : year - 1),
        }),
      },
      validationRepository: {
        listApprovedForOrganization: async () => mappings,
        organizationOwnsApprovedThread: async () => true,
      },
      fileService: {
        copyApprovedThreadAttachments: async () => [],
        listProfileFiles: async () => [],
        openProfileFile: async () => "",
      },
    }));

    const response = await request(app).get("/google-workspace/profiles/org-1/emails");

    expect(response.status).toBe(200);
    expect(response.body.conversations.map((row: any) => row.threadId)).toEqual(["current-thread"]);
    expect(response.body.historicalConversations.map((row: any) => row.threadId)).toEqual(["older-thread"]);
  });
});
