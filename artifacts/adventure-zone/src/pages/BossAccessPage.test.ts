import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Boss Access routing", () => {
  it("gives Desie a direct booking-tool route for Boss login management", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const menu = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
    const page = readFileSync("src/pages/BossAccessPage.tsx", "utf8");

    expect(app).toContain('<Route path="/boss-access" component={BossAccessPage} />');
    expect(menu).toContain('{ href: "/boss-access", label: "Boss Access" }');
    expect(page).toContain("<BossAccountPanel />");
    expect(page).toContain("Set the Boss username and password");
  });
});