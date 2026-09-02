import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));

import { resolveInboundCallingMigrationUrl } from "./inbound-calling-required-startup";

describe("inbound calling production migration path", () => {
  it("resolves the migration beside the packaged API bundle instead of from process.cwd()", () => {
    const renderBundleUrl =
      "file:///opt/render/project/src/artifacts/api-server/dist/index.mjs";

    expect(
      fileURLToPath(resolveInboundCallingMigrationUrl(renderBundleUrl)),
    ).toBe(
      "/opt/render/project/src/artifacts/api-server/dist/migrations/20260902_twilio_incoming_computer_calling.sql",
    );
  });
});
