import { describe, expect, it, vi } from "vitest";
import { createGoogleWorkspaceReadClient } from "./google-api-client";

const environment = { clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback", tokenEncryptionKey: "a".repeat(32) };

describe("Google Drive API client", () => {
  it("uses parent-scoped pagination and explicit fields", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      return new Response(JSON.stringify({ files: [{ id: "f1", name: "Contract", mimeType: "application/pdf", size: "12" }], nextPageToken: "next" }));
    });
    const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh", fetcher });
    await expect(client.listDriveFiles!("folder'1", "page-1")).resolves.toMatchObject({ nextPageToken: "next", files: [{ id: "f1", size: 12 }] });
    const driveUrl = new URL(urls.at(-1)!);
    expect(driveUrl.searchParams.get("q")).toBe("'folder\\'1' in parents and trashed = false");
    expect(driveUrl.searchParams.get("pageToken")).toBe("page-1");
    expect(driveUrl.searchParams.get("fields")).toContain("modifiedTime");
  });

  it("exports Google Docs but downloads binary files as media", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh", fetcher });
    await client.downloadDriveFile!("doc", "application/vnd.google-apps.document");
    await client.downloadDriveFile!("pdf", "application/pdf");
    expect(urls.some((url) => url.includes("/doc/export") && url.includes("mimeType=application%2Fpdf"))).toBe(true);
    expect(urls.some((url) => url.includes("/pdf?alt=media"))).toBe(true);
  });
});
