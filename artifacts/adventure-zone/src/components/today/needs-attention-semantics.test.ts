import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { NeedsAttention } from "./needs-attention";

vi.mock("@/lib/auth-token", () => ({
  apiGet: vi.fn().mockRejectedValue(new Error("Research sources unavailable in this focused test")),
}));

describe("Needs Attention semantics", () => {
  it("keeps the exception list focused on route issues rather than contract workflow", () => {
    render(createElement(NeedsAttention, { visibleRouteWarningCount: 2 }));

    expect(screen.getByRole("link", { name: /route issues/i })).toHaveAttribute("href", "/manager-issues");
    expect(screen.queryByText(/contracts needing attention/i)).not.toBeInTheDocument();
  });
});
