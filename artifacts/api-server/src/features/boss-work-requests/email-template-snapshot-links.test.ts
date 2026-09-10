import { describe, expect, it } from "vitest";
import { extractSnapshotLinks } from "./email-template-snapshot-links";

describe("extractSnapshotLinks", () => {
  it("extracts, normalizes, labels, and deduplicates safe links", () => {
    expect(extractSnapshotLinks(`
      <a href="https://example.com/path"> Read more </a>
      <a href="https://example.com/path">Duplicate</a>
      <a href="https://tickets.example.com/buy"><img alt="Buy tickets"></a>
      <a href="https://plain.example.com"></a>
    `)).toEqual({
      safeLinks: [
        { href: "https://example.com/path", label: "Read more" },
        { href: "https://tickets.example.com/buy", label: "Buy tickets" },
        { href: "https://plain.example.com/", label: "plain.example.com" },
      ],
      blockedLinks: [],
    });
  });

  it("blocks unsafe, malformed, and unresolved snapshot links", () => {
    expect(extractSnapshotLinks(`
      <a href="javascript:alert(1)">Bad script</a>
      <a href="/relative">Relative</a>
      <a href="https://example.com/{{eventName}}">Placeholder</a>
      <a href="data:text/plain,no">Data</a>
    `)).toEqual({
      safeLinks: [],
      blockedLinks: [
        { href: "javascript:alert(1)", label: "Bad script", reason: "unsafe_protocol" },
        { href: "/relative", label: "Relative", reason: "malformed_url" },
        {
          href: "https://example.com/{{eventName}}",
          label: "Placeholder",
          reason: "unresolved_placeholder",
        },
        { href: "data:text/plain,no", label: "Data", reason: "unsafe_protocol" },
      ],
    });
  });

  it("uses parsed attributes instead of matching anchor-like text", () => {
    expect(extractSnapshotLinks(`
      <p>&lt;a href="https://fake.example"&gt;not a link&lt;/a&gt;</p>
      <a HREF="https://real.example?a=1&amp;b=2">Real</a>
    `)).toEqual({
      safeLinks: [{ href: "https://real.example/?a=1&b=2", label: "Real" }],
      blockedLinks: [],
    });
  });
});
