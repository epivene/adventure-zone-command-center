import { describe, expect, it } from "vitest";

import { packageResourceSectionDefaults } from "./SettingsPackagesResourcesPage";

describe("Packages & Resources collapsible sections", () => {
  it("keeps package templates open and resource inventory closed by default", () => {
    expect(packageResourceSectionDefaults).toEqual({
      packageTemplatesOpen: true,
      resourceInventoryOpen: false,
      offersOpen: false,
      importedAssetsOpen: false,
    });
  });
});
