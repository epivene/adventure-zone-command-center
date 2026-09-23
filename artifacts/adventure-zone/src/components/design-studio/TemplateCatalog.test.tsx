import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TemplateCatalog } from "./TemplateCatalog";
import type { DesignTemplate } from "@/lib/design-studio-api";

const templates: DesignTemplate[] = [
  { id: "e1", name: "General first outreach", type: "email", templateFamily: "email", state: "active", tags: ["outreach"] },
  { id: "c1", name: "Adventure Zone | Guaranteed fee", type: "contract", templateFamily: "contract", state: "active", tags: ["adventure_zone"] },
  { id: "p1", name: "Mini Zone prepaid", type: "proposal", templateFamily: "proposal", state: "active", tags: ["mini_zone"] },
  { id: "old", name: "Agreement outline", type: "contract", templateFamily: "contract", state: "archived" },
];

describe("TemplateCatalog", () => {
  it("shows current family counts and hides archived templates", () => {
    render(<TemplateCatalog templates={templates} onUse={() => undefined} />);
    expect(screen.getByRole("tab", { name: "Emails (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Contracts (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Proposals (1)" })).toBeInTheDocument();
    expect(screen.queryByText("Agreement outline")).not.toBeInTheDocument();
  });

  it("selects a template without sending anything", () => {
    const onUse = vi.fn();
    render(<TemplateCatalog templates={templates} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
    expect(onUse).toHaveBeenCalledWith(templates[0]);
  });
});
