import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/boss-work-requests/BossAttentionQueue", () => ({
  BossAttentionQueue: () => null,
}));
vi.mock("@/lib/boss-auth-context", () => ({
  bossGet: vi.fn().mockResolvedValue({
    submittedReceipts: 0,
    submittedDrafts: [],
    businessDocumentsCount: 0,
    assignments: [],
    reviewAndWrapUp: [],
    checklistAndMaintenance: [],
    recentCompletedMaintenanceEvents: [],
  }),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import BossHomePage from "./BossHomePage";

afterEach(cleanup);

describe("BossHomePage convention shortcut", () => {
  it("opens Dave's at-convention Game directly", async () => {
    render(<BossHomePage />);

    expect(await screen.findByRole("link", { name: /Convention Game/ })).toHaveAttribute(
      "href",
      "/boss/conventions?view=game",
    );
  });
});
