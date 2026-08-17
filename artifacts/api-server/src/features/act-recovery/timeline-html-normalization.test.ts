import { describe, expect, it } from "vitest";

import { normalizeTimeline } from "@/features/act-replacement/normalizers/timeline-normalizer";

describe("ACT history HTML normalization", () => {
  it("turns Gmail-style HTML history into readable plain text before storage", () => {
    const result = normalizeTimeline(
      {
        id: "history-html-1",
        regarding: "E-mail sent",
        details: `<div dir="ltr"><p><span style="font-family:Arial">Hi,</span></p><p>My name is Amy &amp; I work with Dave.</p><ul><li>Option one</li><li>Option two</li></ul></div>`,
        startTime: "2025-07-14T15:58:00Z",
      },
      "2026-08-16T18:00:00Z",
      "history",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("history should normalize");

    expect(result.value.body).toContain("Hi,");
    expect(result.value.body).toContain("My name is Amy & I work with Dave.");
    expect(result.value.body).toContain("Option one");
    expect(result.value.body).toContain("Option two");
    expect(result.value.body).not.toContain("<div");
    expect(result.value.body).not.toContain("font-family");
    expect(result.value.body).not.toContain("&amp;");
  });
});
