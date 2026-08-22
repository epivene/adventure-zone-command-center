import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/App.tsx", "utf8");

describe("App Business Drive reconciliation", () => {
  it("preserves the current command and marketing workspace routes", () => {
    expect(source).toContain('path="/command" component={AdminCommandPanelPage}');
    expect(source).toContain('path="/marketing" component={MarketingHomePage}');
  });

  it("keeps Business Drive owner and manager routes", () => {
    expect(source).toContain("ManagerEventChecklistPage");
    expect(source).toContain('path="/manager/events/:bookingId/checklist/:phase"');
    expect(source).toContain('path="/imports/attendance-history" component={AttendanceHistoryImportPage}');
    expect(source).toContain('path="/settings/business-sources" component={SettingsBusinessSourcesPage}');
    expect(source).toContain('path="/settings/communication-templates" component={SettingsCommunicationTemplatesPage}');
  });
});
