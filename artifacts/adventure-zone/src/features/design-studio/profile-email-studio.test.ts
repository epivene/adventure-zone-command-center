import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/design-studio-api", () => ({ designStudioApi: api }));

import {
  createProfileEmailProject,
  safeProfileReturnTo,
  selectProfileEmailContact,
} from "./profile-email-studio";

beforeEach(() => api.create.mockReset());

describe("profile email studio", () => {
  it("uses the active primary email, then the first active emailed contact", () => {
    expect(
      selectProfileEmailContact([
        { id: "secondary", email: "other@example.com", isPrimary: false },
        { id: "primary", email: " gm@example.com ", isPrimary: true },
      ]),
    ).toEqual({ id: "primary", email: "gm@example.com" });

    expect(
      selectProfileEmailContact([
        { id: "primary-empty", email: null, isPrimary: true },
        {
          id: "inactive",
          email: "old@example.com",
          isPrimary: false,
          isActive: false,
        },
        { id: "active", email: "new@example.com", isPrimary: false },
      ]),
    ).toEqual({ id: "active", email: "new@example.com" });
  });

  it("does not guess when no active contact has email", () => {
    expect(
      selectProfileEmailContact([
        {
          id: "inactive",
          email: "old@example.com",
          isPrimary: true,
          isActive: false,
        },
      ]),
    ).toBeNull();
  });

  it("creates a linked default email project and restricts return paths", async () => {
    api.create.mockResolvedValue({ id: "project-1" });

    await expect(
      createProfileEmailProject({
        organizationId: "org-1",
        organizationName: "Prairie Days",
        contactId: "contact-1",
        now: new Date("2026-09-12T12:00:00Z"),
      }),
    ).resolves.toEqual({ id: "project-1" });

    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "email",
        name: "Prairie Days email · Sep 12, 2026",
        linkedOrganizationId: "org-1",
        linkedContactId: "contact-1",
        content: expect.stringContaining('"kind":"branded-email"'),
      }),
    );
    expect(safeProfileReturnTo("/profiles/org-1?section=emails")).toBe(
      "/profiles/org-1?section=emails",
    );
    expect(safeProfileReturnTo("https://evil.example/profiles/org-1")).toBe(
      "/profiles",
    );
  });
});
