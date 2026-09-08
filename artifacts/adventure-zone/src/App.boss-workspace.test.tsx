import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/App.tsx", "utf8");

describe("Boss workspace route protection", () => {
  it("requires a Boss session before mounting the protected workspace", () => {
    expect(source).toContain('<Route path="/boss/sign-in"><BossAuthProvider><BossSignInPage /></BossAuthProvider></Route>');
    expect(source).toContain('<Route path={BOSS_PROTECTED_PATH}><BossAuthProvider><BossProtectedApp /></BossAuthProvider></Route>');
    expect(source).toContain("if (!boss) return <Redirect to=\"/boss/sign-in\" />;");
    expect(source.indexOf('<Route path={BOSS_PROTECTED_PATH}')).toBeLessThan(source.indexOf("<Route><Protected><AdminProtectedApp"));
  });

  it("exposes Boss-authenticated profile list and detail routes", () => {
    expect(source).toContain('<Route path="/boss/profiles/:profileId">');
    expect(source).toContain('<Route path="/boss/profiles" component={BossProfilesPage} />');
  });

  it("keeps Today and Tasks as explicit Boss redirects to the Boss home", () => {
    expect(source).toContain('<Route path="/boss/today"><Redirect to="/boss" /></Route>');
    expect(source).toContain('<Route path="/boss/tasks"><Redirect to="/boss" /></Route>');
  });

  it("keeps broad booking pages outside the Boss workspace", () => {
    expect(source).toContain('<Route path="/boss/bookings/:id"><Redirect to="/boss/schedule" /></Route>');
    expect(source).toContain('<Route path="/boss/bookings"><Redirect to="/boss/schedule" /></Route>');
    expect(source).not.toContain('import("@/pages/BossBookingsPage")');
    expect(source).not.toContain('import("@/pages/BossBookingDetailPage")');
  });
});
