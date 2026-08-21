import { describe, expect, it } from "vitest";

import type { WebsiteFetchResult } from "./website-audit-http";
import type { WebsiteAuditRecord } from "./website-audit-record-repository";
import { assessWebsiteMatch } from "./website-audit-matcher";

const record: WebsiteAuditRecord = {
  recordId: "10000000-0000-4000-8000-000000000001",
  label: "Idaho County Fair",
  website: "https://idahocountyfair.org",
  city: "Cottonwood",
  region: "ID",
  phone: "208-555-1212",
  primaryEmailDomain: "idahocountyfair.org",
};

function fetched(overrides: Partial<WebsiteFetchResult> = {}): WebsiteFetchResult {
  return {
    requestedUrl: record.website,
    finalUrl: record.website,
    statusCode: 200,
    reachable: true,
    redirected: false,
    title: "Idaho County Fair | Cottonwood, Idaho",
    textSample: "Welcome to the Idaho County Fair in Cottonwood, Idaho. Vendor information and fair schedule.",
    failure: null,
    ...overrides,
  };
}

describe("assessWebsiteMatch", () => {
  it("marks matching event name and city as a high-confidence verified match", () => {
    expect(assessWebsiteMatch({ record, fetched: fetched() })).toMatchObject({
      status: "verified_match",
      confidence: "high",
    });
  });

  it("marks a permanent redirect that still matches the identity as redirected/high", () => {
    expect(assessWebsiteMatch({
      record,
      fetched: fetched({
        finalUrl: "https://www.idahocountyfair.com/",
        redirected: true,
        title: "Idaho County Fair - Cottonwood ID",
      }),
    })).toMatchObject({ status: "redirected", confidence: "high" });
  });

  it("accepts a parent-organization domain when page content identifies the event and place", () => {
    expect(assessWebsiteMatch({
      record: { ...record, website: "https://idahocounty.org/fair" },
      fetched: fetched({
        requestedUrl: "https://idahocounty.org/fair",
        finalUrl: "https://idahocounty.org/fair",
        title: "Idaho County Fair",
        textSample: "Idaho County Fair, Cottonwood ID. Fair board, vendors, schedule.",
      }),
    })).toMatchObject({ status: "verified_match", confidence: "high" });
  });

  it("marks a reachable but unrelated site as a likely mismatch", () => {
    expect(assessWebsiteMatch({
      record,
      fetched: fetched({
        title: "Mountain Plumbing LLC",
        textSample: "Residential plumbing services in Boise, Idaho.",
      }),
    })).toMatchObject({ status: "likely_mismatch" });
  });

  it("keeps weak reachable evidence uncertain rather than calling it wrong", () => {
    expect(assessWebsiteMatch({
      record,
      fetched: fetched({ title: "Events", textSample: "Community events and updates." }),
    })).toMatchObject({ status: "reachable_uncertain" });
  });

  it("marks timeout/dead sites as broken", () => {
    expect(assessWebsiteMatch({
      record,
      fetched: fetched({ reachable: false, statusCode: null, failure: "timeout", title: null, textSample: "" }),
    })).toMatchObject({ status: "broken" });
  });

  it("does not treat missing current-year dates alone as a mismatch", () => {
    expect(assessWebsiteMatch({
      record,
      fetched: fetched({ textSample: "Idaho County Fair in Cottonwood, Idaho. Vendor applications and fair information." }),
    }).status).not.toBe("likely_mismatch");
  });
});
