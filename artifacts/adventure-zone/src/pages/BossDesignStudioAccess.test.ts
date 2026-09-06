import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readWorkspaceSource(path: string) {
  return readFileSync(path, "utf8");
}

describe("Boss Design Studio access", () => {
  it("does not expose Studio in Boss navigation", () => {
    const source = readWorkspaceSource("src/components/boss/boss-shell.tsx");

    expect(source).not.toContain('href: "/boss/design-studio"');
    expect(source).not.toContain('label: "Studio"');
  });

  it("redirects legacy Boss Studio URLs and does not load the Boss editors", () => {
    const source = readWorkspaceSource("src/App.tsx");

    expect(source).not.toContain('import("@/pages/BossDesignStudioPage")');
    expect(source).not.toContain('import("@/pages/BossDesignStudioEditorPage")');
    expect(source).toContain('<Route path="/boss/design-studio/:id"><Redirect to="/boss" /></Route>');
    expect(source).toContain('<Route path="/boss/design-studio"><Redirect to="/boss" /></Route>');
  });

  it("does not link Business Documents back into Boss Studio", () => {
    const source = readWorkspaceSource("src/pages/BossTemplatesFilesPage.tsx");

    expect(source).not.toContain("/boss/design-studio");
    expect(source).not.toContain("Open contract");
  });
});