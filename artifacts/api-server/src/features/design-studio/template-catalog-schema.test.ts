import { describe, expect, it } from "vitest";

import {
  designProjects,
  designTemplates,
  designTemplateFamilyValues,
  designTemplateStateValues,
  designTypeValues,
} from "@workspace/db/design-studio-schema";
import { DESIGN_TYPES } from "../../../adventure-zone/src/lib/design-studio-api";

describe("Design Studio template catalog schema", () => {
  it("supports proposal documents and durable catalog metadata", () => {
    expect(designTypeValues).toContain("proposal");
    expect(DESIGN_TYPES).toContain("proposal");
    expect(designTemplateFamilyValues).toEqual(["email", "contract", "proposal"]);
    expect(designTemplateStateValues).toEqual(["active", "archived"]);
    expect(designTemplates.catalogKey).toBeDefined();
    expect(designTemplates.catalogRevision).toBeDefined();
    expect(designTemplates.templateFamily).toBeDefined();
    expect(designTemplates.state).toBeDefined();
    expect(designTemplates.archivedAt).toBeDefined();
    expect(designProjects.sourceTemplateId).toBeDefined();
    expect(designProjects.sourceCatalogRevision).toBeDefined();
    expect(designProjects.documentYear).toBeDefined();
  });
});
