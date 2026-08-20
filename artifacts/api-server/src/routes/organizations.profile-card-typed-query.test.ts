import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";

import { organizations } from "@/db/schema";

const routeSource = fs.readFileSync(path.resolve(__dirname, "organizations.ts"), "utf8");

describe("profile card enrichment query contract", () => {
  it("maps the existing profile photo column in the Drizzle organization schema", () => {
    const columns = getTableColumns(organizations) as Record<string, { name: string }>;
    expect(columns.profileImageDataUrl?.name).toBe("profile_image_data_url");
  });

  it("loads card details through typed organization and primary-contact queries", () => {
    expect(routeSource).toContain("inArray(organizations.id, ids)");
    expect(routeSource).toContain("organizationContacts.isPrimary");
    expect(routeSource).toContain("contacts.email");
    expect(routeSource).not.toContain("o.email");
    expect(routeSource).not.toContain("any(${ids}::uuid[])");
  });
});
