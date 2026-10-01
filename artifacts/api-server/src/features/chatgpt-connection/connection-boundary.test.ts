import { it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
it("has no runtime import path to app model, extraction, research or job modules", () => {
  const root = resolve("src"),
    seen = new Set<string>(),
    forbidden =
      /(assistant-workspace\/(?:runtime|model-provider|production-reads|document-reader|document-extraction-store|run-store|spending-provider)|lead-scout|profile-filler|worker|\/openai|\/anthropic)/;
  function visit(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    expect(file).not.toMatch(forbidden);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of source.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        node.importClause?.isTypeOnly
      )
        continue;
      const clause = node.importClause;
      if (
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        !clause.name &&
        clause.namedBindings.elements.every((e) => e.isTypeOnly)
      )
        continue;
      const name = node.moduleSpecifier.text;
      expect(name).not.toMatch(/^(openai|@anthropic-ai|@google-cloud)/);
      const target = name.startsWith(".")
        ? resolve(dirname(file), name)
        : name.startsWith("@/")
          ? resolve(root, name.slice(2))
          : null;
      if (target) {
        const path = existsSync(target + ".ts")
          ? target + ".ts"
          : existsSync(target + "/index.ts")
            ? target + "/index.ts"
            : null;
        if (path) visit(path);
      }
    }
  }
  for (const name of [
    "read-service",
    "lead-note-service",
    "profile-update-service",
    "profile-merge-service",
    "profile-merge-executor",
    "draft-followup-service",
    "operation-store",
  ])
    visit(resolve(root, "features/chatgpt-connection/" + name + ".ts"));
  expect(seen.size).toBeGreaterThan(5);
});
