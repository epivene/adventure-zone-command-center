import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const ownerRoutes = app.slice(app.indexOf("function AdminProtectedApp()"), app.indexOf("function AppRoutes()"));
const officeRoutes = app.slice(app.indexOf("function OfficeProtectedApp()"), app.indexOf("function BossProtectedApp()"));
const bossRoutes = app.slice(app.indexOf("function BossProtectedApp()"), app.indexOf("function AdminProtectedApp()"));

describe("lead workspace role routing", () => {
  it("keeps the simplified lead workspace in owner routes only", () => {
    expect(ownerRoutes).toContain('<Route path="/leads"><TodayPage leadsOnly /></Route>');
    expect(officeRoutes).not.toContain('path="/leads"');
    expect(bossRoutes).not.toContain('path="/leads"');
    expect(bossRoutes).toContain('<Route path="/boss/today"><Redirect to="/boss" /></Route>');
  });
});
