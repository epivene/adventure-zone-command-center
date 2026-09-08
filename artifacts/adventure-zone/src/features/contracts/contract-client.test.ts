import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContractClient } from "./contract-client";

const response = (body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
}));

describe("ContractClient", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(() => response()));
  });

  it("calls draft, version, listing, replacement, transition, confirm, and retry endpoints", async () => {
    const client = new ContractClient();
    await client.getSettings();
    await client.updateSettings({ internalSignerName: "Dave Gordon", internalSignerEmail: "dave@example.com", insuranceRecipientName: "Sara Toone", insuranceRecipientEmail: "sara@protectiveins.net" });
    await client.startDraft("booking-1");
    await client.getDraft("draft-1");
    await client.saveDraft("draft-1", 3, {} as never);
    await client.finalizeDraft("draft-1");
    await client.listOrganization("org-1");
    await client.getVersion("version-1");
    await client.createReplacement("version-1");
    await client.openFile("version-1", "file-1");
    await client.confirmAdobeSent("version-1");
    await client.transition("version-1", "partially_signed");
    await client.confirmSignedFile("version-1", "file-2", true);
    await client.retryCoiDraft("version-1");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/contracts/settings"),
      expect.stringContaining("/contracts/settings"),
      expect.stringContaining("/bookings/booking-1/contract-draft"),
      expect.stringContaining("/contract-drafts/draft-1"),
      expect.stringContaining("/contract-drafts/draft-1"),
      expect.stringContaining("/contract-drafts/draft-1/finalize"),
      expect.stringContaining("/organizations/org-1/contracts"),
      expect.stringContaining("/contracts/version-1"),
      expect.stringContaining("/contracts/version-1/replacement"),
      expect.stringContaining("/contracts/version-1/file/open"),
      expect.stringContaining("/contracts/version-1/confirm-adobe-sent"),
      expect.stringContaining("/contracts/version-1/status"),
      expect.stringContaining("/contracts/version-1/signed-file/file-2/confirm"),
      expect.stringContaining("/contracts/version-1/coi-draft/retry"),
    ]);
  });

  it("uploads the signed PDF body and overrides the JSON content type", async () => {
    const client = new ContractClient();
    const file = new File(["%PDF-1.7\nsigned"], "signed agreement.pdf", { type: "application/pdf" });
    await client.uploadSignedPdf("version-1", file);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/contracts/version-1/signed-file"), expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ "Content-Type": "application/pdf", "X-File-Name": "signed agreement.pdf" }),
      body: file,
    }));
  });
});
