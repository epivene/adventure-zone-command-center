import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const adminMenu = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const managerMenu = readFileSync("src/components/manager/manager-menu.tsx", "utf8");

const adminRoutes = [
  "/bookings",
  "/contacts",
  "/calls/workspace",
  "/manager-finance",
  "/manager-communications",
  "/manager-crew",
  "/manager-issues",
  "/settings/packages-resources",
  "/quick-add",
];

const managerRoutes = [
  "/manager/receipts",
  "/manager/operations",
  "/manager/reviews",
  "/manager/incidents",
  "/manager/messages",
];

describe("simplified navigation regression contracts", () => {
  it("keeps every hidden Admin tool both routed and reachable", () => {
    for (const route of adminRoutes) {
      expect(app).toContain(`path=\"${route}`);
      expect(adminMenu).toContain(route);
    }
  });

  it("keeps every hidden manager tool both routed and reachable", () => {
    for (const route of managerRoutes) {
      expect(app).toContain(`path=\"${route}`);
      expect(managerMenu).toContain(route);
    }
  });
});
