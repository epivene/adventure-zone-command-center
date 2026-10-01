import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadProfileCardDetailsWith } from "../features/organizations/profile-card-details";

const routeSource = fs.readFileSync(path.resolve(__dirname, "../features/organizations/profile-card-details.ts"), "utf8");

describe("profile card enrichment query contract", () => {
  it("loads profile photos with individually parameterized UUIDs instead of one array parameter", () => {
    expect(routeSource).toContain("profile_image_data_url");
    expect(routeSource).toContain("sql.join");
    expect(routeSource).not.toContain("any(${ids}::uuid[])");
  });

  it("uses the active primary contact for card email/phone instead of a nonexistent organization email column", () => {
    expect(routeSource).toContain("organization_contacts");
    expect(routeSource).toContain("is_primary");
    expect(routeSource).toContain("contacts");
    expect(routeSource).toContain("coalesce(c.phone, o.phone)");
    expect(routeSource).toContain("c.email");
    expect(routeSource).not.toContain("o.email");
  });
  
  it("returns the saved description with profile card details", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "profile-1", profileImageDataUrl: null }] })
      .mockResolvedValueOnce({ rows: [{
        id: "profile-1",
        phone: null,
        email: null,
        website: null,
        placeType: "event",
        description: "Saved About text",
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await loadProfileCardDetailsWith(["profile-1"], execute);

    expect(result.get("profile-1")?.description).toBe("Saved About text");
  });
});
