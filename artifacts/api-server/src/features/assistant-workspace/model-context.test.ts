import { expect, it } from "vitest";
import { projectModelContext } from "./model-context";
import type { Evidence } from "./contracts";
const evidence = (text: string, fields: Partial<Evidence> = {}): Evidence => ({
  id: "source",
  kind: "profile",
  recordId: "source",
  eventYear: 2027,
  occurredAt: null,
  retrievedAt: "now",
  version: "v1",
  complete: true,
  text,
  ...fields,
});
const output = (
  id: string,
  data: unknown,
  sources: Evidence[],
  receipts: unknown[] = [],
) => ({
  type: "function_call_output",
  call_id: id,
  output: JSON.stringify({
    status: "ok",
    data,
    evidence: sources,
    receipts,
    code: null,
  }),
});
it("retains PDF page provenance and additional visual transcription without repeated page text", () => {
  const pages = [
    { page: 1, text: "UNIQUE_PAGE_TEXT", state: "readable" },
    { page: 2, text: "", state: "visual_review_required" },
  ];
  const e = evidence(
    pages.map((p) => `[Page ${p.page}; ${p.state}]\n${p.text}`).join("\n\n") +
      "\n\n[Visual transcription; requires verification]\nADDITIONAL_VISUAL_DETAILS",
    { kind: "document", complete: false },
  );
  const input = output(
    "document",
    {
      pages,
      totalPages: 2,
      complete: false,
      missingPages: [2],
      executionStatus: "unverified",
    },
    [e],
  );
  const before = JSON.stringify(input);
  const projected = projectModelContext([e], [input]);
  expect(JSON.stringify(projected).match(/UNIQUE_PAGE_TEXT/g)).toHaveLength(1);
  expect(JSON.stringify(projected)).toContain("ADDITIONAL_VISUAL_DETAILS");
  expect(
    JSON.parse((projected.providerItems[0] as any).output).data,
  ).toMatchObject({
    pages: [
      { page: 1, state: "readable", textSourceEvidenceId: "source" },
      { page: 2, state: "visual_review_required" },
    ],
    missingPages: [2],
    executionStatus: "unverified",
  });
  expect(JSON.stringify(input)).toBe(before);
});
it("references repeated reads but keeps changed records and each action receipt", () => {
  const first = { note: "SAME_SOURCE_BODY" },
    newer = { note: "CHANGED_SOURCE_BODY" };
  const e1 = evidence(JSON.stringify(first)),
    e2 = evidence(JSON.stringify(newer), { version: "v2" });
  const receipt = {
    kind: "app_draft",
    id: "draft",
    href: "/draft",
    verifiedAt: "now",
  };
  const projected = projectModelContext(
    [e1, e2],
    [
      output("first", first, [e1]),
      output("repeat", first, [{ ...e1, retrievedAt: "later" }]),
      output("changed", newer, [e2]),
      output("saved", { draftId: "draft" }, [], [receipt]),
    ],
  );
  expect(JSON.stringify(projected).match(/SAME_SOURCE_BODY/g)).toHaveLength(1);
  expect(JSON.stringify(projected).match(/CHANGED_SOURCE_BODY/g)).toHaveLength(
    1,
  );
  expect(JSON.parse((projected.providerItems[1] as any).output).data).toEqual({
    sourceResultCallId: "first",
  });
  expect(
    JSON.parse((projected.providerItems[3] as any).output).receipts,
  ).toEqual([receipt]);
});
it("keeps distinct source text and malformed legacy outputs intact", () => {
  const source = evidence("A unique correction absent from structured data", {
    complete: false,
  });
  const malformed = {
    type: "function_call_output",
    call_id: "legacy",
    output: "not JSON",
  };
  const reasoning = { type: "reasoning", encrypted_content: "opaque" };
  const projected = projectModelContext(
    [source],
    [
      output("read", { note: "Other information" }, [source]),
      malformed,
      reasoning,
    ],
  );
  expect(JSON.stringify(projected)).toContain(source.text);
  expect(projected.providerItems.slice(1)).toEqual([malformed, reasoning]);
});
