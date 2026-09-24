import { it, expect } from "vitest";
import {
  validateTimedEvent,
  timedCalendarBody,
  calendarEventId,
  allDayCalendarBody,
} from "./calendar-tools";
const event = {
  calendarId: "cal",
  summary: "Meeting",
  startsAt: "2027-03-14T02:30:00-07:00",
  endsAt: "2027-03-14T03:30:00-06:00",
  timeZone: "America/Denver",
  organizationId: "profile-a",
  bookingId: null,
};
it("rejects a DST gap rather than shifting the meeting", () => {
  expect(() => validateTimedEvent(event)).toThrow(
    "CALENDAR_LOCAL_TIME_MISMATCH",
  );
});
it.each(["-06:00", "-07:00"])(
  "accepts an explicitly selected autumn fold %s",
  (offset) => {
    expect(() =>
      validateTimedEvent({
        ...event,
        startsAt: `2027-11-07T01:10:00${offset}`,
        endsAt: `2027-11-07T01:40:00${offset}`,
      }),
    ).not.toThrow();
  },
);
it("keeps timed events separate from all-day exclusive ends", () => {
  const good = {
    ...event,
    startsAt: "2027-01-20T10:00:00-07:00",
    endsAt: "2027-01-20T11:00:00-07:00",
  };
  expect(timedCalendarBody(good, "action")).toMatchObject({
    start: { dateTime: good.startsAt, timeZone: "America/Denver" },
    attendees: [],
  });
  expect(allDayCalendarBody("2027-01-20", "2027-01-22")).toEqual({
    start: { date: "2027-01-20" },
    end: { date: "2027-01-22" },
  });
});
it("rejects local timestamps and gives repeatable Google-safe IDs", () => {
  expect(() =>
    validateTimedEvent({ ...event, startsAt: "2027-01-20T10:00:00" }),
  ).toThrow();
  expect(calendarEventId("a")).toBe(calendarEventId("a"));
  expect(calendarEventId("a")).not.toBe(calendarEventId("b"));
  expect(calendarEventId("a")).toMatch(/^[0-9a-v]+$/);
});
