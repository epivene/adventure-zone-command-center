import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import { createGoogleWorkspaceProfileEmailRouter } from "./google-workspace-profile-email";

function googleClient(): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    getMessageMetadata: async (id) => ({
      id,
      threadId: "thread-1",
      labelIds: ["INBOX"],
      internalDateMs: 1000,
      snippet: "County Fair follow up",
      headers: {
        from: "fair@example.org",
        to: "zone@example.com",
        cc: "",
        subject: "County Fair follow up",
        date: "Mon, 24 Aug 2026 10:00:00 -0600",
      },
      hasAttachments: true,
    }),
    getThreadDetail: async () => ({
      id: "thread-1",
      subject: "County Fair follow up",
      originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
      messages: [
        {
          id: "m1",
          internalDateMs: 1000,
          from: "fair@example.org",
          to: "zone@example.com",
          cc: "",
          subject: "County Fair follow up",
          date: "Mon, 24 Aug 2026 10:00:00 -0600",
          direction: "incoming",
          bodyText: "We would like to book you again.",
          attachments: [
            {
              attachmentId: "a1",
              filename: "application.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1200,
              messageId: "m1",
            },
          ],
        },
      ],
    }),
  };
}

function appFor(options?: { ownsThread?: boolean }) {
  const app = express();
  app.use(express.json());
  app.use(
    createGoogleWorkspaceProfileEmailRouter({
      connection: { createReadClient: async () => googleClient() },
      validationRepository: {
        listApprovedForOrganization: async (organizationId) =>
          organizationId === "org-1"
            ? [
                {
                  messageId: "m1",
                  threadId: "thread-1",
                  organizationId: "org-1",
                  contactId: "contact-1",
                  evidenceCodes: ["exact_contact_email", "contact_active_organization"],
                },
              ]
            : [],
        organizationOwnsApprovedThread: async () => options?.ownsThread ?? true,
      },
    }),
  );
  return app;
}

describe("Google Workspace profile email routes", () => {
  it("lists only approved sample conversations mapped to the requested profile", async () => {
    const response = await request(appFor()).get(
      "/google-workspace/profiles/org-1/emails",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      validationSampleOnly: true,
      conversations: [
        {
          threadId: "thread-1",
          subject: "County Fair follow up",
          from: "fair@example.org",
          to: "zone@example.com",
          date: "Mon, 24 Aug 2026 10:00:00 -0600",
          internalDateMs: 1000,
          hasAttachments: true,
          contactId: "contact-1",
          evidenceCodes: ["exact_contact_email", "contact_active_organization"],
          originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
        },
      ],
    });
  });

  it("returns the whole approved thread with readable body and attachment metadata", async () => {
    const response = await request(appFor()).get(
      "/google-workspace/profiles/org-1/emails/thread-1",
    );

    expect(response.status).toBe(200);
    expect(response.body.subject).toBe("County Fair follow up");
    expect(response.body.messages[0].bodyText).toBe(
      "We would like to book you again.",
    );
    expect(response.body.messages[0].attachments[0].filename).toBe(
      "application.pdf",
    );
  });

  it("returns 404 instead of exposing a thread mapped to another profile", async () => {
    const response = await request(appFor({ ownsThread: false })).get(
      "/google-workspace/profiles/org-1/emails/thread-other",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "GOOGLE_WORKSPACE_PROFILE_EMAIL_NOT_FOUND" });
  });
});
