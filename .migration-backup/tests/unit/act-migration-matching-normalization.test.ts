import { describe, expect, it } from "vitest";

import {
  isGenericContactName,
  isSharedMailboxEmail,
  normalizeMatchingEmail,
  normalizeMatchingText,
  normalizeWebsiteHost,
} from "@/features/act-migration/matching-normalization";

describe("Act migration matching normalization", () => {
  it("normalizes matching text with one whitespace-and-case contract", () => {
    expect(normalizeMatchingText("  NEW \t York\nCity  ")).toBe(
      "new york city",
    );
    expect(normalizeMatchingText(" \t ")).toBeNull();
    expect(normalizeMatchingText(null)).toBeNull();
  });

  it("normalizes only syntactically valid matching email addresses", () => {
    expect(normalizeMatchingEmail(" Avery.Example+Act@EXAMPLE.COM ")).toBe(
      "avery.example+act@example.com",
    );
    expect(normalizeMatchingEmail("info@")).toBeNull();
    expect(normalizeMatchingEmail("a b@example.com")).toBeNull();
    expect(normalizeMatchingEmail("a@example..com")).toBeNull();
    expect(normalizeMatchingEmail(".avery@example.com")).toBeNull();
    expect(normalizeMatchingEmail("avery.@example.com")).toBeNull();
  });

  it.each([
    "admin",
    "billing",
    "bookings",
    "boxoffice",
    "contact",
    "customerservice",
    "events",
    "hello",
    "info",
    "inquiries",
    "office",
    "reservations",
    "sales",
    "support",
    "tickets",
  ])("detects the %s shared mailbox including plus tags", (mailbox) => {
    expect(isSharedMailboxEmail(`${mailbox}+act@Example.com`)).toBe(true);
  });

  it("does not treat an invalid address as a shared mailbox", () => {
    expect(isSharedMailboxEmail("info@")).toBe(false);
    expect(isSharedMailboxEmail("avery@example.com")).toBe(false);
  });

  it.each([
    ["Info", "Example Events"],
    ["Box Office", "Example Events"],
    ["General Contact", "Example Events"],
    [" Example   Events ", "example events"],
    [null, "Example Events"],
  ])(
    "classifies %j as a generic/company-only Contact name",
    (displayName, companyName) => {
      expect(isGenericContactName(displayName, companyName)).toBe(true);
    },
  );

  it("keeps a non-generic human name eligible as a Person", () => {
    expect(isGenericContactName("Avery Example", "Example Events")).toBe(
      false,
    );
  });

  it.each([
    ["HTTPS://WWW.Example.COM./path?q=1", "example.com"],
    ["example.com/events", "example.com"],
    ["example.com:8080/events", "example.com"],
    ["sub.www.example.com", "sub.www.example.com"],
    ["http://events.example.com:8080/a", "events.example.com"],
  ])("normalizes website host %j", (input, expected) => {
    expect(normalizeWebsiteHost(input)).toBe(expected);
  });

  it.each([
    "ftp://example.com",
    "https://user:secret@example.com",
    "https:///missing.example",
    "not a host",
    "http://",
    "example..com",
  ])("rejects malformed or unsafe website input %j", (input) => {
    expect(normalizeWebsiteHost(input)).toBeNull();
  });
});
