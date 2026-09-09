import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const criticalFiles = [
  "artifacts/adventure-zone/src/pages/EventProfilePage.tsx",
  "artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.tsx",
  "artifacts/api-server/src/db/schema.ts",
  "artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts",
  "artifacts/api-server/src/features/communication-templates/communication-template-service.ts",
  "artifacts/api-server/src/features/communication-templates/communication-template-types.ts",
  "artifacts/api-server/src/features/office/office-email-repository.ts",
  "artifacts/api-server/src/features/office/office-email-service.ts",
  "artifacts/api-server/src/features/office/office-email-types.ts",
  "artifacts/api-server/src/features/opportunity-email/opportunity-email-delivery.test.ts",
  "artifacts/api-server/src/features/opportunity-email/opportunity-email-service.ts",
  "artifacts/api-server/src/features/opportunity-email/production-opportunity-email-runtime.ts",
  "artifacts/api-server/src/index.startup-order.test.ts",
  "artifacts/api-server/src/index.ts",
  "artifacts/api-server/src/routes/index.ts",
  "artifacts/api-server/src/routes/office-admin-email-drafts.ts",
  "artifacts/api-server/src/routes/office-email-drafts.ts",
  "artifacts/api-server/src/routes/opportunities.ts",
  "lib/db/package.json",
  "lib/db/src/drizzle-schema.ts",
  "lib/db/src/index.ts",
  "lib/db/src/migrations.ts",
  "lib/db/src/office-coordinator-schema.ts",
  "artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.test.tsx",
  "artifacts/api-server/src/routes/opportunities.test.ts"
];

describe("source integrity after Early Bird recovery", () => {
  for (const path of criticalFiles) {
    it(path + " contains valid source", () => {
      const source = readFileSync(new URL(path, root), "utf8");
      expect(source.trim().length).toBeGreaterThan(100);
      expect(source).not.toContain("base64: invalid input");
      if (path.endsWith(".json")) {
        const pkg = JSON.parse(source);
        expect(pkg.name).toBe("@workspace/db");
        expect(pkg.exports["./early-bird-promo-schema"]).toBe("./src/early-bird-promo-schema.ts");
      } else {
        const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
          path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const diagnostics = (parsed as typeof parsed & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
        expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
        expect(parsed.statements.length).toBeGreaterThan(0);
      }
    });
  }
});
