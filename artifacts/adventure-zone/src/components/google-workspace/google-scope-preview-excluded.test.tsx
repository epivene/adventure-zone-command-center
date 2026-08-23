import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleScopePreview } from "./google-scope-preview";

afterEach(cleanup);

describe("GoogleScopePreview excluded label review", () => {
  it("keeps excluded labels collapsed until the user asks to review them", () => {
    render(
      <GoogleScopePreview
        preview={{
          labels: [
            { id: "shows", name: "Shows", rootId: "shows", rootName: "Shows" },
          ],
          calendars: [
            { id: "az", summary: "Adventure Zone Calendar", primary: true },
          ],
          missingLabelRoots: [],
          missingCalendars: [],
          excludedLabelCount: 2,
          excludedCalendarCount: 0,
          excludedLabels: [
            { id: "personal", name: "Personal/Family", type: "user" },
            { id: "TRASH", name: "TRASH", type: "system" },
          ],
        }}
        selectedLabelIds={["shows"]}
        selectedCalendarIds={["az"]}
        onLabelChange={() => undefined}
        onCalendarChange={() => undefined}
      />,
    );

    expect(screen.getByText("2 other Gmail labels not selected")).toBeInTheDocument();
    expect(screen.queryByText("Personal/Family")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /review excluded labels/i }));

    expect(screen.getByText("Personal/Family")).toBeInTheDocument();
    expect(screen.getByText("TRASH")).toBeInTheDocument();
    expect(screen.getByText(/read-only review/i)).toBeInTheDocument();
  });
});
