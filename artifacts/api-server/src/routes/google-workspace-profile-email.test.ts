import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import { createGoogleWorkspaceProfileEmailRouter } from "./google-workspace-profile-email";

function googleClient(overrides?: Partial<GoogleWorkspaceReadClient>): GoogleWorkspaceReadClient {
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
    getThreadDetail: async (threadId) => ({
      id: threadId,
      subject: "County Fair follow up",
      originalGmailUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
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
    ...overrides,
  };
}

const storedFile = {
  id: "file-1",
  organizationId: "org-1",
  threadId: "thread-1",
  messageId: "m1",
  attachmentId: "a1",
  filename: "application.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1200,
  contentSha256: "abc",
  storageObjectKey: "google-workspace/attachments/ab/abc",
  availability: "available" as const,
  lastErrorCode: null,
  createdAt: "2026-08-24T18:00:00.000Z",
};

const defaultMappings = [
  {
    messageId: "m1",
    threadId: "thread-1",
    organizationId: "org-1",
    contactId: "contact-1",
    evidenceCodes: ["exact_contact_email", "contact_active_organization"],
  },
];

function appFor(options?: {
  ownsThread?: boolean;
  copyFiles?: ReturnType<typeof vi.fn>;
  listFiles?: ReturnType<typeof vi.fn>;
  openFile?: ReturnType<typeof vi.fn>;
  client?: GoogleWorkspaceReadClient | null;
  mappings?: typeof defaultMappings;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createGoogleWorkspaceProfileEmailRouter({
      connection: {
        createReadClient: async () =>
          options && "client" in options ? options.client ?? null : googleClient(),
      },
      validationRepository: {
        listApprovedForOrganization: async (organizationId) =>
          organizationId === "org-1" ? options?.mappings ?? defaultMappings : [],
        organizationOwnsApprovedThread: async () => options?.ownsThread ?? true,
      },
      fileService: {
        copyApprovedThreadAttachments:
          options?.copyFiles ?? vi.fn(async () => [storedFile]),
        listProfileFiles:
          options?.listFiles ?? vi.fn(async () => [storedFile]),
        openProfileFile:
          options?.openFile ?? vi.fn(async () => "https://signed.example/file"),
      },
    }),
  );
  return app;
}

describe("Google Workspace profile email routes", () => {
  it("loads matched conversations from the live Gmail thread", async () => {
    const getThreadDetail = vi.fn(googleClient().getThreadDetail!);
    const getMessageMetadata = vi.fn(googleClient().getMessageMetadata!);
    const response = await request(
      appFor({ client: googleClient({ getThreadDetail, getMessageMetadata }) }),
    ).get("/google-workspace/profiles/org-1/emails");

    expect(response.status).toBe(200);
    expect(getThreadDetail).toHaveBeenCalledWith("thread-1");
    expect(getMessageMetadata).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      validationSampleOnly: false,
      historicalBackfillIncluded: true,
      liveGmail: true,
      unavailableThreadCount: 0,
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

  it("does not require Google when the profile has no matched Gmail", async () => {
    const response = await request(
      appFor({ client: null, mappings: [] }),
    ).get("/google-workspace/profiles/org-1/emails");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      liveGmail: true,
      unavailableThreadCount: 0,
      conversations: [],
    });
  });

  it("keeps healthy live threads visible when one historical thread is unavailable", async () => {
    const mappings = [
      ...defaultMappings,
      {
        messageId: "m2",
        threadId: "thread-stale",
        organizationId: "org-1",
        contactId: null,
        evidenceCodes: ["historical_gmail_backfill"],
      },
    ];
    const client = googleClient({
      getThreadDetail: async (threadId) => {
        if (threadId === "thread-stale") {
          throw new Error("GOOGLE_WORKSPACE_API_REQUEST_FAILED");
        }
        return googleClient().getThreadDetail!(threadId);
      },
    });

    const response = await request(appFor({ client, mappings })).get(
      "/google-workspace/profiles/org-1/emails",
    );

    expect(response.status).toBe(200);
    expect(response.body.unavailableThreadCount).toBe(1);
    expect(response.body.conversations).toHaveLength(1);
    expect(response.body.conversations[0].threadId).toBe("thread-1");
  });

  it("returns a useful reauthorization status when live Gmail cannot load", async () => {
    const client = googleClient({
      getThreadDetail: async () => {
        throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
      },
    });
    const response = await request(appFor({ client })).get(
      "/google-workspace/profiles/org-1/emails",
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
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

  it("copies approved conversation attachments into the profile Files area", async () => {
    const copyFiles = vi.fn(async () => [storedFile]);
    const response = await request(appFor({ copyFiles })).post(
      "/google-workspace/profiles/org-1/threads/thread-1/copy-files",
    );

    expect(response.status).toBe(200);
    expect(copyFiles).toHaveBeenCalledWith({
      organizationId: "org-1",
      threadId: "thread-1",
    });
    expect(response.body.files[0].filename).toBe("application.pdf");
  });

  it("lists files only for the requested profile", async () => {
    const listFiles = vi.fn(async () => [storedFile]);
    const response = await request(appFor({ listFiles })).get(
      "/google-workspace/profiles/org-1/files",
    );

    expect(response.status).toBe(200);
    expect(listFiles).toHaveBeenCalledWith("org-1");
    expect(response.body.files).toHaveLength(1);
  });

  it("opens a profile-owned file with a 15-minute signed URL", async () => {
    const openFile = vi.fn(async () => "https://signed.example/file");
    const response = await request(appFor({ openFile })).post(
      "/google-workspace/profiles/org-1/files/file-1/open",
    );

    expect(response.status).toBe(200);
    expect(openFile).toHaveBeenCalledWith({
      organizationId: "org-1",
      fileId: "file-1",
    });
    expect(response.body).toEqual({
      url: "https://signed.example/file",
      expiresInSeconds: 900,
    });
  });
});