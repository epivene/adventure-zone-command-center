// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { PackageResourceEditor } from "@/components/bookings/package-resource-editor";
import { ResourceWarningList } from "@/components/bookings/resource-warning-list";
import { SpecialRequestEditor } from "@/components/bookings/special-request-editor";
import type { BookingPackageResourceEditorModel } from "@/features/bookings/booking-repository";

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  adventure: "22222222-2222-4222-8222-222222222222",
  weekend: "33333333-3333-4333-8333-333333333333",
  retired: "44444444-4444-4444-8444-444444444444",
  paintball: "55555555-5555-4555-8555-555555555555",
  archived: "66666666-6666-4666-8666-666666666666",
  paintballAssignment: "77777777-7777-4777-8777-777777777777",
  archivedAssignment: "88888888-8888-4888-8888-888888888888",
  request: "99999999-9999-4999-8999-999999999999",
};

const model: BookingPackageResourceEditorModel = {
  bookingId: ids.booking,
  physicalAttractionTotal: 11,
  attractionTotalApprovalReason: null,
  packageOptions: [
    {
      id: ids.adventure,
      code: "adventure_zone",
      name: "Adventure Zone",
      baseAttractionCount: 10,
      active: true,
      selected: true,
    },
    {
      id: ids.weekend,
      code: "weekend_warriors",
      name: "Weekend Warriors",
      baseAttractionCount: 5,
      active: true,
      selected: true,
    },
    {
      id: ids.retired,
      code: "retired_package",
      name: "Retired package",
      baseAttractionCount: 3,
      active: false,
      selected: false,
    },
  ],
  resourceOptions: [
    {
      id: ids.paintball,
      code: "paintball",
      name: "Paintball",
      status: "available",
      countsAsAttraction: true,
      packageTemplateIds: [ids.weekend, ids.adventure],
      assigned: true,
      assignmentId: ids.paintballAssignment,
      attributionSource: "inferred",
      attributedPackageIds: [ids.adventure, ids.weekend],
    },
    {
      id: ids.archived,
      code: "historic_trailer",
      name: "Historic trailer",
      status: "archived",
      countsAsAttraction: false,
      packageTemplateIds: [ids.adventure],
      assigned: true,
      assignmentId: ids.archivedAssignment,
      attributionSource: "manual",
      attributedPackageIds: [],
    },
  ],
  assignedAttractionCount: 1,
  specialRequests: [
    {
      id: ids.request,
      bookingId: ids.booking,
      description: "Ferris wheel",
      treatment: "add_to_count",
      approvalStatus: "needs_approval",
      decisionReason: null,
      decidedAt: null,
      createdAt: new Date("2026-07-29T12:00:00.000Z"),
      updatedAt: new Date("2026-07-29T12:00:00.000Z"),
    },
  ],
  warnings: [
    {
      code: "RESOURCE_OVERLAP",
      conflictKey: "current-overlap-key",
      resourceId: ids.paintball,
      assignmentIds: [ids.paintballAssignment],
      message: "Paintball is already assigned to another event.",
      overridden: false,
      override: null,
    },
  ],
};

describe("PackageResourceEditor", () => {
  it("shows the saved shared total, explicit suggestion, and historical selections", () => {
    render(
      <PackageResourceEditor
        configurePackages={vi.fn()}
        configureResources={vi.fn()}
        model={model}
      />,
    );

    expect(screen.getByText("2 packages · 11 attractions")).toBeVisible();
    expect(screen.getByText(/Suggested 10.*usual range 10–12/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Use suggested total" })).toBeVisible();
    expect(screen.getByLabelText(/Retired package.*inactive/i)).not.toBeChecked();
    expect(screen.getByLabelText(/Historic trailer.*archived/i)).toBeChecked();
  });

  it("retains a historically selected inactive package visibly", () => {
    render(
      <PackageResourceEditor
        configurePackages={vi.fn()}
        configureResources={vi.fn()}
        model={{
          ...model,
          packageOptions: model.packageOptions.map((option) =>
            option.id === ids.retired ? { ...option, selected: true } : option
          ),
        }}
      />,
    );

    expect(screen.getByLabelText(/Retired package.*inactive/i)).toBeChecked();
  });

  it("uses the suggestion only when requested and requires a reason outside policy", async () => {
    const user = userEvent.setup();
    render(
      <PackageResourceEditor
        configurePackages={vi.fn()}
        configureResources={vi.fn()}
        model={model}
      />,
    );

    const total = screen.getByLabelText("Physical attraction total");
    expect(total).toHaveValue(11);
    await user.click(screen.getByRole("button", { name: "Use suggested total" }));
    expect(total).toHaveValue(10);
    await user.clear(total);
    await user.type(total, "13");
    expect(screen.getByLabelText("Out-of-range approval reason")).toBeRequired();
  });

  it("keeps the two-package policy range unchanged when an approved request raises only the suggestion", async () => {
    const user = userEvent.setup();
    render(
      <PackageResourceEditor
        configurePackages={vi.fn()}
        configureResources={vi.fn()}
        model={{
          ...model,
          physicalAttractionTotal: 12,
          specialRequests: [{
            ...model.specialRequests[0]!,
            approvalStatus: "approved",
            decisionReason: "Owner approved",
            decidedAt: new Date("2026-07-29T13:00:00.000Z"),
          }],
        }}
      />,
    );

    expect(screen.getByText(/Suggested 11.*usual range 10–12/i)).toBeVisible();
    expect(screen.getByLabelText("Out-of-range approval reason")).not.toBeRequired();

    const total = screen.getByLabelText("Physical attraction total");
    await user.clear(total);
    await user.type(total, "13");
    expect(screen.getByLabelText("Out-of-range approval reason")).toBeRequired();
  });

  it("keeps a single-package base boundary when an approved request raises its suggestion", async () => {
    const user = userEvent.setup();
    render(
      <PackageResourceEditor
        configurePackages={vi.fn()}
        configureResources={vi.fn()}
        model={{
          ...model,
          physicalAttractionTotal: 10,
          packageOptions: model.packageOptions.map((option) => ({
            ...option,
            selected: option.id === ids.adventure,
          })),
          specialRequests: [{
            ...model.specialRequests[0]!,
            approvalStatus: "approved",
            decisionReason: "Owner approved",
            decidedAt: new Date("2026-07-29T13:00:00.000Z"),
          }],
        }}
      />,
    );

    expect(screen.getByText(/Suggested 11.*usual range 10–10/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use suggested total" }));
    expect(screen.getByLabelText("Physical attraction total")).toHaveValue(11);
    expect(screen.getByLabelText("Out-of-range approval reason")).toBeRequired();
  });

  it("submits every manual attribution while preserving inferred and deliberate empty choices", async () => {
    const configurePackages = vi.fn(async () => ({ ok: true as const }));
    const user = userEvent.setup();
    render(
      <PackageResourceEditor
        configurePackages={configurePackages}
        configureResources={vi.fn()}
        model={model}
      />,
    );

    expect(screen.getByText("Inferred: Adventure Zone, Weekend Warriors")).toBeVisible();
    expect(screen.getByText("Manual: no packages")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save package setup" }));

    await waitFor(() => {
      expect(configurePackages).toHaveBeenCalledWith({
        bookingId: ids.booking,
        packageTemplateIds: [ids.adventure, ids.weekend],
        physicalAttractionTotal: 11,
        attractionTotalApprovalReason: null,
        manualAttributions: [
          {
            bookingResourceAssignmentId: ids.paintballAssignment,
            packageTemplateIds: null,
          },
          {
            bookingResourceAssignmentId: ids.archivedAssignment,
            packageTemplateIds: [],
          },
        ],
      });
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("starts manual attribution from current selected inferred tags after package changes", async () => {
    const configurePackages = vi.fn(async () => ({ ok: true as const }));
    const user = userEvent.setup();
    render(
      <PackageResourceEditor
        configurePackages={configurePackages}
        configureResources={vi.fn()}
        model={model}
      />,
    );

    await user.click(screen.getByLabelText(/Adventure Zone.*10 base/i));
    const paintball = screen.getByRole("group", {
      name: "Paintball attribution",
    });
    await user.click(within(paintball).getByLabelText("Choose packages manually"));
    expect(within(paintball).queryByLabelText("Adventure Zone")).not.toBeInTheDocument();
    expect(within(paintball).getByLabelText("Weekend Warriors")).toBeChecked();
    await user.type(
      screen.getByLabelText("Out-of-range approval reason"),
      "Preserve saved total",
    );
    await user.click(screen.getByRole("button", { name: "Save package setup" }));

    expect(configurePackages).toHaveBeenCalledWith(expect.objectContaining({
      packageTemplateIds: [ids.weekend],
      manualAttributions: [
        {
          bookingResourceAssignmentId: ids.paintballAssignment,
          packageTemplateIds: [ids.weekend],
        },
        {
          bookingResourceAssignmentId: ids.archivedAssignment,
          packageTemplateIds: [],
        },
      ],
    }));
  });

  it("keeps paintball counted once despite attribution to two packages", () => {
    render(
      <PackageResourceEditor
        configurePackages={vi.fn()}
        configureResources={vi.fn()}
        model={model}
      />,
    );

    expect(screen.getByText("1 assigned attraction")).toBeVisible();
  });

  it("signals package-save completion only after the pending action resolves", async () => {
    let finish!: (result: { ok: true }) => void;
    const configurePackages = vi.fn(() =>
      new Promise<{ ok: true }>((resolve) => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();
    render(
      <PackageResourceEditor
        configurePackages={configurePackages}
        configureResources={vi.fn()}
        model={model}
      />,
    );
    const save = screen.getByRole("button", { name: "Save package setup" });

    await user.click(save);
    expect(save).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(save);
    expect(configurePackages).toHaveBeenCalledOnce();
    finish({ ok: true });
    await waitFor(() => expect(save).toBeEnabled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Package setup saved.",
    );
    await user.type(
      screen.getByLabelText("Out-of-range approval reason"),
      "Updated after save",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SpecialRequestEditor", () => {
  it("shows pending treatment and decides with a required reason", async () => {
    const decideRequest = vi.fn(async () => ({ ok: true as const }));
    const user = userEvent.setup();
    render(
      <SpecialRequestEditor
        addRequest={vi.fn()}
        bookingId={ids.booking}
        decideRequest={decideRequest}
        requests={model.specialRequests}
      />,
    );

    expect(screen.getByText("Ferris wheel")).toBeVisible();
    expect(screen.getByText(/Add to count.*Needs approval/i)).toBeVisible();
    await user.type(screen.getByLabelText("Decision reason for Ferris wheel"), "Owner approved");
    await user.click(screen.getByRole("button", { name: "Approve Ferris wheel" }));
    expect(decideRequest).toHaveBeenCalledWith({
      specialRequestId: ids.request,
      decision: "approved",
      reason: "Owner approved",
    });
  });

  it("focuses readable feedback after a failed request decision", async () => {
    const user = userEvent.setup();
    render(
      <SpecialRequestEditor
        addRequest={vi.fn()}
        bookingId={ids.booking}
        decideRequest={vi.fn(async () => ({
          ok: false as const,
          error: "This request was already decided.",
        }))}
        requests={model.specialRequests}
      />,
    );

    await user.type(screen.getByLabelText("Decision reason for Ferris wheel"), "Owner approved");
    await user.click(screen.getByRole("button", { name: "Approve Ferris wheel" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This request was already decided.");
    expect(alert).toHaveFocus();
  });
});

describe("ResourceWarningList", () => {
  it("keeps active and overridden conflicts visible with accessible override controls", async () => {
    const acknowledge = vi.fn(async () => ({ ok: true as const }));
    const user = userEvent.setup();
    render(
      <ResourceWarningList
        acknowledge={acknowledge}
        bookingId={ids.booking}
        warnings={[
          ...model.warnings,
          {
            ...model.warnings[0]!,
            conflictKey: "overridden-key",
            overridden: true,
            override: {
              reason: "Dispatcher approved",
              acknowledgedBy: "owner_1",
              createdAt: new Date("2026-07-29T12:00:00.000Z"),
            },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Paintball is already assigned to another event.")).toHaveLength(2);
    expect(screen.getByText(/Overridden.*Dispatcher approved/i)).toBeVisible();
    expect(screen.getByText(/owner_1.*2026-07-29T12:00:00.000Z/i)).toBeVisible();
    await user.type(
      screen.getByLabelText(/Override reason for Paintball is already assigned/i),
      "Approved shared schedule",
    );
    await user.click(screen.getByRole("button", {
      name: /Override Paintball is already assigned/i,
    }));
    expect(acknowledge).toHaveBeenCalledWith({
      bookingId: ids.booking,
      conflictKey: "current-overlap-key",
      reason: "Approved shared schedule",
    });
  });

  it("focuses readable feedback after a stale conflict override", async () => {
    const user = userEvent.setup();
    render(
      <ResourceWarningList
        acknowledge={vi.fn(async () => ({
          ok: false as const,
          error: "This conflict changed. Refresh and review it.",
        }))}
        bookingId={ids.booking}
        warnings={model.warnings}
      />,
    );

    await user.type(
      screen.getByLabelText(/Override reason for Paintball is already assigned/i),
      "Owner approved",
    );
    await user.click(screen.getByRole("button", {
      name: /Override Paintball is already assigned/i,
    }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
  });
});
