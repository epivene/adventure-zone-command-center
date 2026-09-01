// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerEventReviewPage from "./ManagerEventReviewPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string) => {
    if (path === "/manager/reviews/due") {
      return {
        reviewsDue: [],
        recentCompleted: {
          event: {
            id: "miles-city",
            name: "Eastern Montana Fair",
            city: "Miles City",
            region: "MT",
            startsAt: "2026-08-20T14:00:00.000Z",
            endsAt: "2026-08-23T23:00:00.000Z",
          },
          review: {
            id: "review-miles-city",
            rating: 5,
            feedback: "Good event",
            createdAt: "2026-08-24T12:00:00.000Z",
          },
        },
        nextUpcoming: {
          id: "meeteetse",
          name: "Meeteetse Annual Labor Day Celebration 2026",
          city: "Meeteetse",
          region: "WY",
          startsAt: "2026-09-05T17:00:00.000Z",
          endsAt: "2026-09-07T17:00:00.000Z",
        },
      };
    }
    if (path === "/manager/organizer-feedback") {
      return {
        reviews: [],
        summary: {
          reviewCount: 0,
          averageOverallRating: null,
          inviteBackRate: null,
        },
      };
    }
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ managerApi: mocks.api }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManagerEventReviewPage", () => {
  it("shows the most recent completed report and next upcoming event instead of stale prompts", async () => {
    render(<ManagerEventReviewPage />);

    expect(await screen.findByText("Eastern Montana Fair")).toBeInTheDocument();
    expect(screen.getByText("Miles City, MT")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();

    expect(screen.getByText("Meeteetse Annual Labor Day Celebration 2026")).toBeInTheDocument();
    expect(screen.getByText("Meeteetse, WY")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();

    expect(screen.queryByText("Moorcroft Jubilee Days")).not.toBeInTheDocument();
    expect(screen.queryByText("Sublette County Fair")).not.toBeInTheDocument();
  });
});
