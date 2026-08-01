// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("not found"); }),
  redirect,
}));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner-1" })),
}));

import OrganizationDetailPage from "@/app/(private)/organizations/[organizationId]/page";
import { OrganizationList } from "@/components/organizations/organization-list";
import { AppShell } from "@/components/navigation/app-shell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Places and Contacts navigation", () => {
  it("renders Places and Contacts as separate primary navigation destinations", () => {
    render(<AppShell><p>Page content</p></AppShell>);

    for (const label of ["Places", "Contacts"]) {
      const links = screen.getAllByRole("link", { name: label });
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", label === "Places" ? "/organizations" : "/contacts");
      }
    }
  });

  it("carries the current Places filters into a place detail link", () => {
    render(
      <OrganizationList
        organizations={{
          records: [{
            id: "place-1",
            name: "Marias Fair",
            lastResort: false,
            lastResortReason: null,
            lastResortChangedAt: null,
            contactCount: 2,
            bookingCount: 1,
          }],
          total: 1,
          page: 2,
          pageSize: 25,
          pageCount: 2,
        }}
        query={{ search: "Marias", lastResort: "only", travelLegId: "leg-1", page: 2, pageSize: 25 }}
        travelLegs={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "Marias Fair" })).toHaveAttribute(
      "href",
      "/organizations/place-1?returnTo=%2Forganizations%3Fq%3DMarias%26lastResort%3Donly%26leg%3Dleg-1%26page%3D2%26pageSize%3D25",
    );
  });

  it("redirects a legacy place detail URL into its unified event profile", async () => {
    await expect(OrganizationDetailPage({
      params: Promise.resolve({ organizationId: "11111111-1111-4111-8111-111111111111" }),
    })).rejects.toThrow("redirect:/event-profiles/11111111-1111-4111-8111-111111111111");
    expect(redirect).toHaveBeenCalledWith("/event-profiles/11111111-1111-4111-8111-111111111111");
  });
});
