from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"anchor missing in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


def add_tests() -> None:
    shell_test = Path(
        "artifacts/adventure-zone/src/components/navigation/app-shell.test.tsx"
    )
    text = shell_test.read_text()
    old = '      ["/bookings", "Bookings"],'
    new = '      ["/profiles", "Profiles"],'
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise SystemExit("desktop Booking navigation test anchor missing")

    old = (
        '    for (const href of ["/profiles", "/calls/workspace", '
        '"/research-sources"]) {'
    )
    new = (
        '    for (const href of ["/bookings", "/calls/workspace", '
        '"/research-sources"]) {'
    )
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise SystemExit("desktop Booking hidden-navigation test anchor missing")
    shell_test.write_text(text)

    Path("artifacts/adventure-zone/src/pages/BookingsPage.test.ts").write_text(
        textwrap.dedent(
            '''\
            import { readFileSync } from "node:fs";
            import { describe, expect, it } from "vitest";

            const bookingsPageSource = readFileSync("src/pages/BookingsPage.tsx", "utf8");
            const todayPageSource = readFileSync("src/pages/TodayPage.tsx", "utf8");
            const todayFocusSource = readFileSync("src/features/today/today-focus.ts", "utf8");

            describe("profile-first booking navigation", () => {
              it("redirects the legacy top-level Bookings list to Profiles", () => {
                expect(bookingsPageSource).toContain('<Redirect to="/profiles" />');
                expect(bookingsPageSource).not.toContain('apiGet<any>("/bookings")');
              });

              it("routes Today booking work into Profiles instead of the hidden list", () => {
                expect(todayPageSource).not.toContain('href="/bookings"');
                expect(todayFocusSource).toContain('primaryHref: "/profiles"');
                expect(todayFocusSource).not.toContain('primaryHref: "/bookings"');
              });
            });
            '''
        )
    )

    Path(
        "artifacts/adventure-zone/src/components/profiles/"
        "profile-bookings-primary.test.ts"
    ).write_text(
        textwrap.dedent(
            '''\
            import { readFileSync } from "node:fs";
            import { describe, expect, it } from "vitest";

            const source = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

            describe("bookings inside the permanent event profile", () => {
              it("opens the profile's booking records by default when they exist", () => {
                expect(source).toContain('profile.bookings.length ? "events" : null');
                expect(source).toContain('label="Bookings"');
                expect(source).toContain('>Bookings & opportunities</h2>');
                expect(source).not.toContain('label="Upcoming events"');
              });

              it("keeps individual yearly booking details reachable from the profile", () => {
                expect(source).toContain('href={`/bookings/${booking.id}`}');
                expect(source).toContain('{booking.status.replaceAll("_", " ")}');
              });
            });
            '''
        )
    )

    Path(
        "artifacts/api-server/src/features/approved-profile-import/"
        "pirate-fest-confirmed.test.ts"
    ).write_text(
        textwrap.dedent(
            '''\
            import { readFileSync } from "node:fs";
            import { fileURLToPath } from "node:url";
            import { describe, expect, it } from "vitest";

            const fixturePath = fileURLToPath(
              new URL(
                "../../../../../imports/approved-profiles/pirate-fest-northglenn-co-2026.json",
                import.meta.url,
              ),
            );
            const payload = JSON.parse(readFileSync(fixturePath, "utf8"));

            describe("Pirate Fest reviewed relationship state", () => {
              it("records the signed current contract as confirmed", () => {
                expect(payload.booking.status).toBe("confirmed");
                expect(payload.booking.nextActionKind).toBe("renewal");
              });

              it("retains one next-year renewal instead of stale current contract work", () => {
                expect(payload.followUps).toHaveLength(1);
                expect(payload.followUps[0].dueAt).toMatch(/^2027-/);
                expect(
                  `${payload.followUps[0].label} ${payload.followUps[0].reason}`.toLowerCase(),
                ).toContain("2027");
              });

              it("removes the superseded non-booking story", () => {
                const text = JSON.stringify(payload).toLowerCase();
                expect(text).toContain("signed");
                expect(text).toContain("confirmed");
                expect(text).not.toMatch(
                  /budget cuts|will not use adventure zone|passed because/,
                );
              });
            });
            '''
        )
    )


def apply_fix() -> None:
    replace_once(
        "artifacts/adventure-zone/src/components/navigation/app-shell.tsx",
        '{ href: "/bookings", label: "Bookings", icon: UsersRound },',
        '{ href: "/profiles", label: "Profiles", icon: UsersRound },',
    )

    menu_path = Path(
        "artifacts/adventure-zone/src/components/navigation/app-menu.tsx"
    )
    menu_text = menu_path.read_text()
    booking_line = '  { href: "/bookings", label: "Bookings" },\n'
    if booking_line in menu_text:
        menu_path.write_text(menu_text.replace(booking_line, "", 1))

    Path("artifacts/adventure-zone/src/pages/BookingsPage.tsx").write_text(
        'import { Redirect } from "wouter";\n\n'
        "export default function BookingsPage() {\n"
        '  return <Redirect to="/profiles" />;\n'
        "}\n"
    )

    profile_path = (
        "artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx"
    )
    replace_once(
        profile_path,
        "  const [openSection, setOpenSection] = useState<OpenSection>(null);",
        '''  const [openSection, setOpenSection] = useState<OpenSection>(() =>
    profile.bookings.length ? "events" : null,
  );''',
    )

    profile_file = Path(profile_path)
    profile_text = profile_file.read_text()
    reset_effect = '''  useEffect(() => {
    setOpenSection(profile.bookings.length ? "events" : null);
  }, [profile.id, profile.bookings.length]);'''
    if reset_effect not in profile_text:
        anchor = '''  useEffect(() => {
    setOptimisticActivities([]);
  }, [profile.id]);'''
        if anchor not in profile_text:
            raise SystemExit("profile-id reset effect anchor missing")
        profile_text = profile_text.replace(
            anchor,
            f"{anchor}\n\n{reset_effect}",
            1,
        )

    profile_text = profile_text.replace(
        '          label="Upcoming events"',
        '          label="Bookings"',
        1,
    )
    profile_text = profile_text.replace(
        ">Bookings and opportunities</p>",
        ">Yearly booking records</p>",
        1,
    )
    profile_text = profile_text.replace(
        ">Upcoming events</h2>",
        ">Bookings & opportunities</h2>",
        1,
    )
    profile_text = profile_text.replace(
        "No events have been added yet.",
        "No bookings have been added yet.",
        1,
    )
    profile_file.write_text(profile_text)

    today_page = Path("artifacts/adventure-zone/src/pages/TodayPage.tsx")
    today_text = today_page.read_text()
    if 'href="/bookings"' in today_text:
        today_page.write_text(today_text.replace('href="/bookings"', 'href="/profiles"'))
    elif 'href="/profiles"' not in today_text:
        raise SystemExit("Today Booking-work link anchor missing")

    replace_once(
        "artifacts/adventure-zone/src/features/today/today-focus.ts",
        '      primaryHref: "/bookings",',
        '      primaryHref: "/profiles",',
    )

    pirate_path = Path(
        "imports/approved-profiles/pirate-fest-northglenn-co-2026.json"
    )
    pirate = json.loads(pirate_path.read_text())
    pirate["profile"]["description"] = (
        "Confirmed Adventure Zone booking for Pirate Fest 2026 in Northglenn. "
        "The event contract has been signed. Keep this permanent event profile "
        "as the relationship record and retain the 2027 renewal follow-up."
    )
    pirate["booking"]["status"] = "confirmed"
    pirate["booking"]["nextActionKind"] = "renewal"
    pirate["booking"]["nextActionDueAt"] = "2027-01-15"
    pirate["notes"] = [
        {
            "subject": "Pirate Fest 2026 signed contract / confirmed booking",
            "body": (
                "The Pirate Fest 2026 contract has been signed, so the current "
                "booking is confirmed. The current contract follow-up is complete. "
                "Keep the January 2027 reminder to reconnect with Michael about "
                "the next Pirate Fest."
            ),
        }
    ]
    pirate["followUps"] = [
        {
            "label": "Renew Pirate Fest with Michael Ringling for 2027",
            "reason": (
                "The 2026 Pirate Fest contract is signed and the booking is confirmed. "
                "Reconnect with Michael early about Pirate Fest 2027 and continue from "
                "the established booked relationship."
            ),
            "dueAt": "2027-01-15T15:00:00.000Z",
        }
    ]
    pirate_path.write_text(json.dumps(pirate, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"tests", "fix"}:
        raise SystemExit("usage: profiles_primary_pirate_fix.py tests|fix")
    if sys.argv[1] == "tests":
        add_tests()
    else:
        apply_fix()
