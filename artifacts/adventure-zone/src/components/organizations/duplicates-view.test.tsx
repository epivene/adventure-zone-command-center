import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DuplicatesView, type DuplicateGroup } from "./duplicates-view";

const { apiPost, toast } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiPost }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

function organization(id: string, name: string) {
  return {
    id,
    name,
    city: "Breckenridge",
    region: "CO",
    contactCount: 1,
    bookingCount: 0,
    primaryContactName: null,
    lastResort: false,
  } as any;
}

function group(name: string, suffix: string): DuplicateGroup {
  return {
    normalizedName: name,
    classification: "duplicate",
    city: "Breckenridge",
    region: "CO",
    organizations: [
      organization(`primary-${suffix}`, `${name} primary`),
      organization(`duplicate-${suffix}`, `${name} duplicate`),
    ],
  };
}

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("DuplicatesView bulk merge", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiPost.mockReset();
    toast.mockReset();
  });

  it("requires confirmation and cancels without merging", async () => {
    render(
      <DuplicatesView
        groups={[group("alpha", "a"), group("bravo", "b")]}
        onRefresh={vi.fn().mockResolvedValue([])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge all 2 groups" }));

    expect(
      screen.getByRole("heading", { name: "Merge all duplicate profiles?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /linked contacts, bookings, follow-ups, activities, history, and ACT links/i,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(apiPost).not.toHaveBeenCalled();
  });

  it("uses the selected primaries, merges sequentially, and shows progress", async () => {
    const first = deferred();
    const second = deferred();
    apiPost
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(
      <DuplicatesView
        groups={[group("alpha", "a"), group("bravo", "b")]}
        onRefresh={vi.fn().mockResolvedValue([])}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /alpha duplicate/i }));
    fireEvent.click(screen.getByRole("button", { name: "Merge all 2 groups" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Merge all 2 groups",
      }),
    );

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenNthCalledWith(1, "/organizations/merge", {
      primaryId: "duplicate-a",
      duplicateIds: ["primary-a"],
    });
    expect(screen.getByText("Merging 0 of 2")).toBeInTheDocument();

    await act(async () => first.resolve());

    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Merging 1 of 2")).toBeInTheDocument();

    await act(async () => second.resolve());

    expect(
      await screen.findByText("No duplicate profiles found"),
    ).toBeInTheDocument();
  });

  it("stops on failure and resumes only the remaining groups", async () => {
    const remainingGroups = [group("bravo", "b"), group("charlie", "c")];
    const onRefresh = vi
      .fn()
      .mockResolvedValueOnce(remainingGroups)
      .mockResolvedValueOnce([]);
    apiPost
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    render(
      <DuplicatesView
        groups={[
          group("alpha", "a"),
          group("bravo", "b"),
          group("charlie", "c"),
        ]}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge all 3 groups" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Merge all 3 groups",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not merge “bravo”. 1 of 3 completed.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    expect(apiPost).toHaveBeenCalledTimes(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Resume remaining merges" }),
    );

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(4));
    expect(apiPost).toHaveBeenNthCalledWith(3, "/organizations/merge", {
      primaryId: "primary-b",
      duplicateIds: ["duplicate-b"],
    });
    expect(apiPost).toHaveBeenNthCalledWith(4, "/organizations/merge", {
      primaryId: "primary-c",
      duplicateIds: ["duplicate-c"],
    });
    expect(
      await screen.findByText("No duplicate profiles found"),
    ).toBeInTheDocument();
  });

  it("reconciles remaining groups with refreshed server truth", () => {
    const { rerender } = render(
      <DuplicatesView
        groups={[group("alpha", "a")]}
        onRefresh={vi.fn().mockResolvedValue([])}
      />,
    );

    rerender(
      <DuplicatesView
        groups={[group("bravo", "b")]}
        onRefresh={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(screen.queryByText("alpha primary")).not.toBeInTheDocument();
    expect(screen.getByText("bravo primary")).toBeInTheDocument();
  });

  it("does not offer Resume until server reconciliation finishes", async () => {
    const refresh = deferred();
    const alpha = group("alpha", "a");
    apiPost.mockRejectedValueOnce(new Error("connection lost"));
    render(
      <DuplicatesView
        groups={[alpha]}
        onRefresh={vi.fn().mockReturnValue(refresh.promise)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge all 1 group" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Merge all 1 group",
      }),
    );

    expect(
      await screen.findByText("Checking server status…"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume remaining merges" }),
    ).not.toBeInTheDocument();

    await act(async () => refresh.resolve([alpha]));

    expect(
      await screen.findByRole("button", { name: "Resume remaining merges" }),
    ).toBeEnabled();
  });

  it("keeps groups visible and requires a status retry when refresh fails", async () => {
    apiPost.mockRejectedValueOnce(new Error("connection lost"));
    render(
      <DuplicatesView
        groups={[group("alpha", "a")]}
        onRefresh={vi.fn().mockResolvedValue(null)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge all 1 group" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Merge all 1 group",
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Retry status refresh" }),
    ).toBeInTheDocument();
    expect(screen.getByText("alpha primary")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume remaining merges" }),
    ).not.toBeInTheDocument();
  });

  it("unblocks Resume when a parent status retry refreshes the groups", async () => {
    const alpha = group("alpha", "a");
    apiPost.mockRejectedValueOnce(new Error("connection lost"));
    const { rerender } = render(
      <DuplicatesView
        groups={[alpha]}
        onRefresh={vi.fn().mockResolvedValue(null)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge all 1 group" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Merge all 1 group",
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Retry status refresh" }),
    ).toBeInTheDocument();

    rerender(
      <DuplicatesView
        groups={[alpha]}
        onRefresh={vi.fn().mockResolvedValue([alpha])}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Resume remaining merges" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Retry status refresh" }),
    ).not.toBeInTheDocument();
  });

  it("requires explicit reselection if the refreshed Primary disappeared", async () => {
    const alpha = group("alpha", "a");
    const refreshedAlpha = {
      ...alpha,
      organizations: [
        organization("primary-a", "alpha original"),
        organization("replacement-a", "alpha replacement"),
      ],
    };
    apiPost.mockRejectedValueOnce(new Error("connection lost"));
    render(
      <DuplicatesView
        groups={[alpha]}
        onRefresh={vi.fn().mockResolvedValue([refreshedAlpha])}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /alpha duplicate/i }));
    fireEvent.click(screen.getByRole("button", { name: "Merge all 1 group" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Merge all 1 group",
      }),
    );

    const resume = await screen.findByRole("button", {
      name: "Resume remaining merges",
    });
    expect(resume).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a Primary below before resuming",
    );

    fireEvent.click(screen.getByRole("radio", { name: /alpha original/i }));

    expect(resume).toBeEnabled();
  });
});
