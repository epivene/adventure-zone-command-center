import { describe, expect, it, vi } from "vitest";

import type { WebsiteAuditRecord } from "./website-audit-record-repository";
import { SearchWebsiteReplacementProvider } from "./website-audit-replacement-provider";

const record: WebsiteAuditRecord = {
  recordId: "10000000-0000-4000-8000-000000000001",
  label: "Idaho County Fair",
  website: "https://old.example.invalid",
  city: "Cottonwood",
  region: "ID",
  phone: null,
  primaryEmailDomain: "idahocountyfair.org",
};

describe("SearchWebsiteReplacementProvider", () => {
  it("returns high confidence only for strong official identity evidence", async () => {
    const search = vi.fn().mockResolvedValue([
      {
        url: "https://idahocountyfair.org/",
        title: "Idaho County Fair | Cottonwood, Idaho",
        snippet: "Official Idaho County Fair website in Cottonwood ID",
        sourceRef: "https://idahocountyfair.org/",
      },
    ]);
    const inspect = vi.fn().mockResolvedValue({ reachable: true, finalUrl: "https://idahocountyfair.org/", failure: null });
    const provider = new SearchWebsiteReplacementProvider({ search, inspect: { inspect } as never });

    await expect(provider.findOfficialReplacement(record)).resolves.toMatchObject({
      url: "https://idahocountyfair.org/",
      confidence: "high",
    });
  });

  it("downgrades weak search evidence so it cannot be bulk-applied", async () => {
    const search = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/community-events",
        title: "Community Events",
        snippet: "Local events",
        sourceRef: "https://example.com/community-events",
      },
    ]);
    const inspect = vi.fn().mockResolvedValue({ reachable: true, finalUrl: "https://example.com/community-events", failure: null });
    const provider = new SearchWebsiteReplacementProvider({ search, inspect: { inspect } as never });

    const result = await provider.findOfficialReplacement(record);
    expect(result?.confidence).not.toBe("high");
  });

  it("rejects candidates that fail safe URL inspection", async () => {
    const search = vi.fn().mockResolvedValue([
      { url: "http://127.0.0.1/admin", title: "Idaho County Fair", snippet: "Cottonwood ID", sourceRef: "unsafe" },
    ]);
    const inspect = vi.fn().mockResolvedValue({ reachable: false, finalUrl: null, failure: "unsafe_url" });
    const provider = new SearchWebsiteReplacementProvider({ search, inspect: { inspect } as never });

    await expect(provider.findOfficialReplacement(record)).resolves.toBeNull();
  });
});
