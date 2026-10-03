// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";
import { WorkspaceSwitcher } from "@/components/navigation/workspace-switcher";
afterEach(cleanup);
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync("src/pages/RoutesPage.tsx", "utf8");
const appSource = readFileSync("src/App.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");


describe("route browsing vs leg management split", () => {
  it("keeps leg management out of embedded Schedule route browsing", () => {
    expect(routesSource).toContain("managementOnly = false");
    expect(routesSource).toContain("{!embedded && !managementOnly ? managementSection : null}");
  });

  it("provides a dedicated Operations leg-management page", () => {
    expect(routesSource).toContain("export function LegManagementPage()");
    expect(routesSource).toContain("<RoutesContent managementOnly />");
    expect(appSource).toContain('<Route path="/operations/legs" component={LegManagementPage} />');
  });

  it("points Operations navigation at the dedicated leg-management route", async () => {
    expect(menuSource).toContain('{ href: "/operations/legs", label: "Leg management" }');
    render(createElement(WorkspaceSwitcher, { workspace: "booking" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Current workspace: Booking" }), { key: "ArrowDown" });
    expect(await screen.findByRole("menuitem", { name: "Legs & Operations" })).toHaveAttribute("href", "/operations/legs");
  });
});
