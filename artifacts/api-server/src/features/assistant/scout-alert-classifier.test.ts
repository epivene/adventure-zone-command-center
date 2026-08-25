import { describe, expect, it } from "vitest";

import {
  evaluateScoutAlerts,
  monitoringProblemAlert,
} from "./scout-alert-classifier";
import type {
  ScoutAlertSnapshot,
  ScoutAlertSource,
} from "./scout-alert-types";

const officialSource: ScoutAlertSource = {
  url: "https://example.org/twin-falls-fair",
  title: "Twin Falls County Fair",
  publisher: "Twin Falls County Fair",
  category: "official_event",
  retrievedAt: "2026-08-25T12:00:00.000Z",
};

function snapshot(overrides: Partial<ScoutAlertSnapshot> = {}): ScoutAlertSnapshot {
  return {
    startsAt: null,
    endsAt: null,
    applicationAvailable: false,
    applicationUrl: null,
    applicationDeadline: null,
    organizerName: null,
    organizerEmail: null,
    organizerPhone: null,
    coverageGaps: [],
    sources: [officialSource],
    capturedAt: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

function evaluate(input: {
  previous?: ScoutAlertSnapshot | null;
  current?: ScoutAlertSnapshot;
  now?: Date;
  baseline?: boolean;
}) {
  return evaluateScoutAlerts({
    watchId: "watch-1",
    profileName: "Twin Falls County Fair",
    previous: input.previous ?? null,
    current: input.current ?? snapshot(),
    now: input.now ?? new Date("2026-08-25T12:00:00.000Z"),
    baseline: input.baseline ?? false,
  });
}

describe("evaluateScoutAlerts", () => {
  it("does not report baseline values as newly changed", () => {
    const alerts = evaluate({
      baseline: true,
      current: snapshot({
        startsAt: "2026-09-02",
        endsAt: "2026-09-07",
        applicationAvailable: true,
        applicationUrl: "https://example.org/vendors",
        organizerName: "Fair Office",
        organizerEmail: "fair@example.org",
        organizerPhone: "208-555-0100",
      }),
    });

    expect(alerts.filter((alert) => [
      "dates_announced",
      "dates_changed",
      "application_opened",
      "contact_changed",
    ].includes(alert.kind))).toEqual([]);
  });

  it("alerts when event dates are announced", () => {
    const alerts = evaluate({
      previous: snapshot({ startsAt: null, endsAt: null }),
      current: snapshot({ startsAt: "2026-09-02", endsAt: "2026-09-07" }),
    });

    expect(alerts).toContainEqual(expect.objectContaining({
      kind: "dates_announced",
      severity: "attention",
      title: "Event dates announced",
      beforeValue: { startsAt: null, endsAt: null },
      afterValue: { startsAt: "2026-09-02", endsAt: "2026-09-07" },
      confidence: "high",
    }));
  });

  it("alerts when reliable event dates change", () => {
    const alerts = evaluate({
      previous: snapshot({ startsAt: "2026-09-02", endsAt: "2026-09-07" }),
      current: snapshot({ startsAt: "2026-09-03", endsAt: "2026-09-08" }),
    });

    expect(alerts).toContainEqual(expect.objectContaining({
      kind: "dates_changed",
      severity: "attention",
      title: "Event dates changed",
      beforeValue: { startsAt: "2026-09-02", endsAt: "2026-09-07" },
      afterValue: { startsAt: "2026-09-03", endsAt: "2026-09-08" },
    }));
  });

  it("alerts when an application path opens", () => {
    const alerts = evaluate({
      previous: snapshot({ applicationAvailable: false, applicationUrl: null }),
      current: snapshot({
        applicationAvailable: true,
        applicationUrl: "https://example.org/vendors",
      }),
    });

    expect(alerts).toContainEqual(expect.objectContaining({
      kind: "application_opened",
      severity: "attention",
      title: "Application opportunity found",
      beforeValue: { available: false, url: null },
      afterValue: { available: true, url: "https://example.org/vendors" },
    }));
  });

  it("ignores contact formatting changes", () => {
    const alerts = evaluate({
      previous: snapshot({
        organizerName: "Fair Office",
        organizerEmail: "FAIR@example.org",
        organizerPhone: "(208) 555-0100",
      }),
      current: snapshot({
        organizerName: "  fair   office ",
        organizerEmail: "fair@EXAMPLE.ORG",
        organizerPhone: "208-555-0100",
      }),
    });

    expect(alerts.some((alert) => alert.kind === "contact_changed")).toBe(false);
  });

  it("groups real organizer contact changes into one alert", () => {
    const alerts = evaluate({
      previous: snapshot({
        organizerName: "Fair Office",
        organizerEmail: "old@example.org",
        organizerPhone: "208-555-0100",
      }),
      current: snapshot({
        organizerName: "Fair Office",
        organizerEmail: "new@example.org",
        organizerPhone: "208-555-0101",
      }),
    });

    const contactAlerts = alerts.filter((alert) => alert.kind === "contact_changed");
    expect(contactAlerts).toHaveLength(1);
    expect(contactAlerts[0]).toMatchObject({
      severity: "attention",
      title: "Organizer contact changed",
      beforeValue: {
        name: "Fair Office",
        email: "old@example.org",
        phone: "208-555-0100",
      },
      afterValue: {
        name: "Fair Office",
        email: "new@example.org",
        phone: "208-555-0101",
      },
    });
  });

  it("does not alert when a stable snapshot has no active deadline or critical gaps", () => {
    const stable = snapshot({
      startsAt: "2026-11-10",
      endsAt: "2026-11-12",
      applicationAvailable: true,
      applicationUrl: "https://example.org/vendors",
      organizerEmail: "fair@example.org",
    });

    expect(evaluate({ previous: stable, current: { ...stable } })).toEqual([]);
  });

  it("groups important missing information into one verification alert", () => {
    const alerts = evaluate({
      baseline: true,
      current: snapshot({
        coverageGaps: [
          "Organizer contact could not be confirmed.",
          "Power requirements were not published.",
          "No recent photos were found.",
          "Vendor application details are unclear.",
        ],
      }),
    });

    const gaps = alerts.filter((alert) => alert.kind === "needs_verification");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      severity: "info",
      title: "Scout information still needs verification",
      afterValue: [
        "Organizer contact could not be confirmed.",
        "Power requirements were not published.",
        "Vendor application details are unclear.",
      ],
    });
  });

  it("ignores noncritical research gaps", () => {
    const alerts = evaluate({
      baseline: true,
      current: snapshot({
        coverageGaps: [
          "No recent photos were found.",
          "Historical attendance anecdotes were limited.",
        ],
      }),
    });

    expect(alerts.some((alert) => alert.kind === "needs_verification")).toBe(false);
  });

  it.each([
    ["2026-09-19", 30, "info"],
    ["2026-09-07", 14, "attention"],
    ["2026-08-31", 7, "urgent"],
    ["2026-08-25", 1, "urgent"],
  ] as const)("creates the applicable deadline alert for %s", (deadline, threshold, severity) => {
    const alerts = evaluate({
      baseline: false,
      previous: snapshot({ applicationDeadline: deadline }),
      current: snapshot({ applicationDeadline: deadline }),
    });

    expect(alerts).toContainEqual(expect.objectContaining({
      kind: "deadline_approaching",
      severity,
      title: `Application deadline within ${threshold} day${threshold === 1 ? "" : "s"}`,
      afterValue: { deadline, thresholdDays: threshold },
      dueAt: `${deadline}T23:59:59.999Z`,
    }));
  });

  it("emits only the most urgent currently applicable deadline threshold", () => {
    const alerts = evaluate({
      baseline: true,
      current: snapshot({ applicationDeadline: "2026-08-31" }),
    }).filter((alert) => alert.kind === "deadline_approaching");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.afterValue).toEqual({
      deadline: "2026-08-31",
      thresholdDays: 7,
    });
  });

  it("does not alert for a deadline that has already passed", () => {
    const alerts = evaluate({
      previous: snapshot({ applicationDeadline: "2026-08-24" }),
      current: snapshot({ applicationDeadline: "2026-08-24" }),
    });

    expect(alerts.some((alert) => alert.kind === "deadline_approaching")).toBe(false);
  });

  it("uses stable but distinct fingerprints for separate changes", () => {
    const first = evaluate({
      previous: snapshot({ startsAt: null }),
      current: snapshot({ startsAt: "2026-09-02" }),
    }).find((alert) => alert.kind === "dates_announced");
    const repeated = evaluate({
      previous: snapshot({ startsAt: null }),
      current: snapshot({ startsAt: "2026-09-02" }),
    }).find((alert) => alert.kind === "dates_announced");
    const changed = evaluate({
      previous: snapshot({ startsAt: "2026-09-02" }),
      current: snapshot({ startsAt: "2026-09-03" }),
    }).find((alert) => alert.kind === "dates_changed");

    expect(first?.fingerprint).toBe(repeated?.fingerprint);
    expect(first?.fingerprint).not.toBe(changed?.fingerprint);
  });
});

describe("monitoringProblemAlert", () => {
  it("waits for three consecutive failures", () => {
    expect(monitoringProblemAlert({
      watchId: "watch-1",
      profileName: "Twin Falls County Fair",
      failureCount: 2,
    })).toBeNull();
  });

  it("creates one stable low-severity monitoring alert after three failures", () => {
    const alert = monitoringProblemAlert({
      watchId: "watch-1",
      profileName: "Twin Falls County Fair",
      failureCount: 3,
    });
    const later = monitoringProblemAlert({
      watchId: "watch-1",
      profileName: "Twin Falls County Fair",
      failureCount: 5,
    });

    expect(alert).toMatchObject({
      kind: "monitoring_problem",
      severity: "info",
      title: "Scout could not refresh this profile",
      afterValue: { consecutiveFailures: 3 },
    });
    expect(alert?.fingerprint).toBe(later?.fingerprint);
  });
});
