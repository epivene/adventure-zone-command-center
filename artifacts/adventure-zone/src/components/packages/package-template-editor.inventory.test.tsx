import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PackageTemplateEditor } from "./package-template-editor";

describe("PackageTemplateEditor inventory capacity", () => {
  it("renders and submits explicit normal capacity and maintenance quantities", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<PackageTemplateEditor templates={[{
      id: "00000000-0000-4000-8000-000000000001",
      code: "adventure_zone", name: "Adventure Zone",
      basePriceCents: 900000, baseAttractionCount: 10,
      normalCapacity: 5, temporaryUnavailableQuantity: 1,
      minimumAttractionCount: 10, maximumAttractionCount: 12, active: true,
    }]} onSubmit={onSubmit} />);

    expect(screen.getByLabelText("Adventure Zone normal capacity")).toHaveValue(5);
    expect(screen.getByLabelText("Adventure Zone temporary unavailable quantity")).toHaveValue(1);
    fireEvent.change(screen.getByLabelText("Adventure Zone normal capacity"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Adventure Zone temporary unavailable quantity"), { target: { value: "2" } });
    fireEvent.submit(screen.getByLabelText("Edit Adventure Zone package"));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      normalCapacity: 4, temporaryUnavailableQuantity: 2,
    })));
  });

  it("rejects negative capacity before submitting", () => {
    const onSubmit = vi.fn();
    render(<PackageTemplateEditor templates={[{
      id: "00000000-0000-4000-8000-000000000001",
      code: "mini_zone", name: "Mini Zone", baseAttractionCount: 5,
      normalCapacity: 0, temporaryUnavailableQuantity: 0,
      minimumAttractionCount: 5, maximumAttractionCount: 5, active: true,
    }]} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Mini Zone normal capacity"), { target: { value: "-1" } });
    fireEvent.submit(screen.getByLabelText("Edit Mini Zone package"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be negative/i);
  });
});
