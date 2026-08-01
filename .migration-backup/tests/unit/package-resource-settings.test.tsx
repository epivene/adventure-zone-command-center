// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { AppShell } from "@/components/navigation/app-shell";
import { PackageTemplateEditor } from "@/components/packages/package-template-editor";
import { ResourceInventoryEditor } from "@/components/resources/resource-inventory-editor";

const templates = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "adventure_zone",
    name: "Adventure Zone",
    baseAttractionCount: 10,
    active: true,
  },
  {
    id: "11111111-1111-4111-8111-111111111112",
    code: "weekend_warriors",
    name: "Weekend Warriors",
    baseAttractionCount: 5,
    active: false,
  },
];

const legs = [
  {
    id: "22222222-2222-4222-8222-222222222221",
    name: "North",
    archivedAt: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Old route",
    archivedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "22222222-2222-4222-8222-222222222223",
    name: "Other old route",
    archivedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
];

const resources = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    code: "paintball_trailer",
    name: "Paintball trailer",
    category: "trailer",
    countsAsAttraction: true,
    packageTemplateIds: [templates[1]!.id],
    normalTravelLegId: legs[1]!.id,
    movable: true,
    setupMinutes: 30,
    teardownMinutes: 20,
    minimumTransferMinutes: 60,
    status: "available" as const,
  },
];

beforeEach(() => {
  refresh.mockClear();
});

afterEach(cleanup);

describe("package and resource settings", () => {
  it("links the settings page from desktop and mobile menus", () => {
    render(<AppShell><p>Settings page</p></AppShell>);

    const links = screen.getAllByRole("link", {
      name: "Packages & resources",
    });
    expect(links).toHaveLength(2);
    expect(links.every((link) =>
      link.getAttribute("href") === "/settings/packages-resources"
    )).toBe(true);
  });

  it("shows stable package codes read-only and supports deactivation without deletion", () => {
    render(
      <PackageTemplateEditor templates={templates} onSubmit={vi.fn()} />,
    );

    expect(screen.getByLabelText("Adventure Zone stable code")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText("Adventure Zone active")).toBeChecked();
    expect(screen.getByLabelText("Weekend Warriors active")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("submits a trimmed package update, reports status, refreshes, and disables while saving", async () => {
    let resolveSave!: (value: { ok: true }) => void;
    const onSubmit = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <PackageTemplateEditor templates={templates} onSubmit={onSubmit} />,
    );

    const form = screen.getByRole("form", {
      name: "Edit Adventure Zone package",
    });
    await user.clear(within(form).getByLabelText("Adventure Zone name"));
    await user.type(
      within(form).getByLabelText("Adventure Zone name"),
      "  Adventure Zone Deluxe  ",
    );
    await user.click(within(form).getByRole("button", { name: "Save package" }));

    expect(within(form).getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolveSave({ ok: true });
    expect(
      await within(form).findByRole("status"),
    ).toHaveTextContent("Package saved.");
    expect(onSubmit).toHaveBeenCalledWith({
      id: templates[0]!.id,
      name: "Adventure Zone Deluxe",
      baseAttractionCount: 10,
      active: true,
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("lets an owner remove and restore retained inactive tags and archived legs before saving", async () => {
    const user = userEvent.setup();
    render(
      <ResourceInventoryEditor
        resources={resources}
        packageTemplates={templates}
        travelLegs={legs}
        onSubmit={vi.fn()}
      />,
    );

    const editForm = screen.getByRole("form", {
      name: "Edit Paintball trailer resource",
    });
    expect(
      within(editForm).getByLabelText(
        "Weekend Warriors (Inactive — retained for history)",
      ),
    ).toBeChecked();
    expect(
      within(editForm).getByRole("option", {
        name: "Old route (Archived — retained for history)",
      }),
    ).toBeInTheDocument();
    expect(within(editForm).queryByText("Other old route")).not.toBeInTheDocument();

    const retainedTag = within(editForm).getByLabelText(
      "Weekend Warriors (Inactive — retained for history)",
    );
    await user.click(retainedTag);
    expect(retainedTag).not.toBeChecked();
    expect(
      within(editForm).getByLabelText(
        "Weekend Warriors (Inactive — retained for history)",
      ),
    ).toBeInTheDocument();
    await user.click(retainedTag);
    expect(retainedTag).toBeChecked();

    const travelLeg = within(editForm).getByLabelText("Normal travel leg");
    await user.selectOptions(travelLeg, legs[0]!.id);
    expect(
      within(editForm).getByRole("option", {
        name: "Old route (Archived — retained for history)",
      }),
    ).toBeInTheDocument();
    await user.selectOptions(travelLeg, legs[1]!.id);
    expect(travelLeg).toHaveValue(legs[1]!.id);

    const createForm = screen.getByRole("form", { name: "Create resource" });
    expect(within(createForm).queryByText("Weekend Warriors")).not.toBeInTheDocument();
    expect(within(createForm).queryByText("Old route")).not.toBeInTheDocument();
  });

  it("creates a complete resource input and offers archive instead of deletion", async () => {
    let resolveSave!: (value: { ok: true }) => void;
    const onSubmit = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <ResourceInventoryEditor
        resources={resources}
        packageTemplates={templates}
        travelLegs={legs}
        onSubmit={onSubmit}
      />,
    );

    const form = screen.getByRole("form", { name: "Create resource" });
    await user.type(within(form).getByLabelText("Stable code"), "  NEW_RIG  ");
    await user.type(within(form).getByLabelText("Resource name"), "  New rig  ");
    await user.type(within(form).getByLabelText("Category"), "  Trailer  ");
    await user.click(within(form).getByLabelText("Counts as an attraction"));
    await user.click(within(form).getByLabelText("Adventure Zone"));
    await user.selectOptions(
      within(form).getByLabelText("Normal travel leg"),
      legs[0]!.id,
    );
    await user.click(within(form).getByLabelText("Movable between events"));
    await user.clear(within(form).getByLabelText("Setup minutes"));
    await user.type(within(form).getByLabelText("Setup minutes"), "30");
    await user.clear(within(form).getByLabelText("Teardown minutes"));
    await user.type(within(form).getByLabelText("Teardown minutes"), "20");
    await user.clear(within(form).getByLabelText("Minimum transfer minutes"));
    await user.type(within(form).getByLabelText("Minimum transfer minutes"), "60");
    await user.selectOptions(
      within(form).getByLabelText("Availability status"),
      "archived",
    );
    await user.click(within(form).getByRole("button", { name: "Create resource" }));

    expect(within(form).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledWith({
      id: null,
      code: "new_rig",
      name: "New rig",
      category: "Trailer",
      countsAsAttraction: true,
      packageTemplateIds: [templates[0]!.id],
      normalTravelLegId: legs[0]!.id,
      movable: true,
      setupMinutes: 30,
      teardownMinutes: 20,
      minimumTransferMinutes: 60,
      status: "archived",
    });
    resolveSave({ ok: true });
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "Resource saved.",
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("shows readable alert feedback and keeps an existing resource code immutable", async () => {
    const user = userEvent.setup();
    render(
      <ResourceInventoryEditor
        resources={resources}
        packageTemplates={templates}
        travelLegs={legs}
        onSubmit={vi.fn(async () => ({
          ok: false as const,
          error: "That resource code is already in use.",
        }))}
      />,
    );

    const form = screen.getByRole("form", {
      name: "Edit Paintball trailer resource",
    });
    expect(within(form).getByLabelText("Stable code")).toHaveAttribute("readonly");
    await user.click(within(form).getByRole("button", { name: "Save resource" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "That resource code is already in use.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
