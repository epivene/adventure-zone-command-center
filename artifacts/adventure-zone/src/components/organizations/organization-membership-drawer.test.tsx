// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationMembershipDrawer } from "./organization-membership-drawer";

const navigate = vi.fn();
const apiGet = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/event-profiles/p1", navigate] }));
vi.mock("@/lib/auth-token", () => ({ apiGet, apiPut, apiDelete }));

const parent = { id: "11111111-1111-4111-8111-111111111111", name: "Water Lantern Festival" };
const child = { id: "22222222-2222-4222-8222-222222222222", name: "Denver Water Lantern", city: "Denver", region: "CO" };

afterEach(cleanup);

beforeEach(() => {
  navigate.mockReset();
  apiGet.mockReset();
  apiPut.mockReset();
  apiDelete.mockReset();
});

describe("OrganizationMembershipDrawer", () => {
  it("finds an existing child and confirms before moving it from another organization", async () => {
    apiGet.mockResolvedValue({ profiles: [{ ...child, currentParent: { id: "33333333-3333-4333-8333-333333333333", name: "Old Parent", city: null, region: null } }] });
    apiPut.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<OrganizationMembershipDrawer mode="add-child" profileId={parent.id} parentOrganization={parent} currentParent={null} open onClose={vi.fn()} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("Search profiles"), { target: { value: "Denver" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Denver Water Lantern");
    fireEvent.click(screen.getByRole("button", { name: /Denver Water Lantern/ }));
    expect(screen.getByText(/currently belongs to Old Parent/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move to Water Lantern Festival" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`/event-profiles/${child.id}/organization`, { organizationId: parent.id }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers Create new from parent mode", () => {
    render(<OrganizationMembershipDrawer mode="add-child" profileId={parent.id} parentOrganization={parent} currentParent={null} open onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    expect(navigate).toHaveBeenCalledWith(`/event-profiles/new?organizationId=${parent.id}`);
  });

  it("searches parent organizations and attaches the profile", async () => {
    apiGet.mockResolvedValue({ organizations: [parent] });
    apiPut.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<OrganizationMembershipDrawer mode="choose-parent" profileId={child.id} parentOrganization={null} currentParent={null} open onClose={vi.fn()} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("Search organizations"), { target: { value: "Water" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Water Lantern Festival");
    fireEvent.click(screen.getByRole("button", { name: /Water Lantern Festival/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Water Lantern Festival" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`/event-profiles/${child.id}/organization`, { organizationId: parent.id }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("removes current membership", async () => {
    apiDelete.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<OrganizationMembershipDrawer mode="choose-parent" profileId={child.id} parentOrganization={null} currentParent={parent} open onClose={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from organization" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`/event-profiles/${child.id}/organization`));
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps server conflicts visible", async () => {
    apiGet.mockResolvedValue({ organizations: [parent] });
    apiPut.mockRejectedValue(new Error("This relationship would create nested organization membership."));
    render(<OrganizationMembershipDrawer mode="choose-parent" profileId={child.id} parentOrganization={null} currentParent={null} open onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Water Lantern Festival");
    fireEvent.click(screen.getByRole("button", { name: /Water Lantern Festival/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Water Lantern Festival" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/nested organization membership/i);
  });
});
