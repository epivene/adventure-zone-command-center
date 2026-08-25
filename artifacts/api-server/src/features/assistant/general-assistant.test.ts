import { describe, expect, it } from "vitest";
import { answerGeneralAssistant, isLeadDiscoveryQuestion } from "./general-assistant";
import type { ProfileSearchRepository } from "./profile-search-repository";
import type { ProfileSearchRequest } from "./profile-search-types";

function fakeRepo(calls: ProfileSearchRequest[]): ProfileSearchRepository {
  return {
    async search(input) {
      calls.push(input);
      return [];
    },
  };
}

describe("isLeadDiscoveryQuestion", () => {
  it("recognizes the approved corridor + date discovery prompt", () => {
    expect(isLeadDiscoveryQuestion("I need to find an event for, between Montana and Utah in September 2026")).toBe(true);
  });

  it("recognizes date-window vendor/fair discovery", () => {
    expect(isLeadDiscoveryQuestion("Find vendor opportunities at fairs in Idaho in August 2027")).toBe(true);
  });

  it("recognizes simple nearby event discovery without magic date wording", () => {
    expect(isLeadDiscoveryQuestion("Find events around Miles City")).toBe(true);
    expect(isLeadDiscoveryQuestion("Scout fairs within 200 miles of Miles City")).toBe(true);
  });

  it("does not steal simple named-profile searches", () => {
    expect(isLeadDiscoveryQuestion("Find Water Lantern Festival")).toBe(false);
    expect(isLeadDiscoveryQuestion("Find Morton County Fair")).toBe(false);
  });

  it("does not treat ordinary workflow questions as lead scouting", () => {
    expect(isLeadDiscoveryQuestion("Who has overdue follow-ups?")).toBe(false);
    expect(isLeadDiscoveryQuestion("What should I work on today?")).toBe(false);
  });
});

describe("answerGeneralAssistant", () => {
  it("routes a named profile lookup to structured search", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Find Morton County Fair", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Morton County Fair", limit: 8 });
  });

  it("treats plain seasonal event phrases as structured event discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Christmas events", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Christmas", limit: 8 });
  });

  it("strips the suggested search wording before seasonal event discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Find Christmas events", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Christmas", limit: 8 });
  });

  it("strips conversational search wording before event-theme discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Show me Halloween festivals", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Halloween", limit: 8 });
  });

  it("supports common named event categories without requiring find/search wording", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Oktoberfest", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Oktoberfest", limit: 8 });
  });

  it("keeps numbered holiday names intact for discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "4th of July", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "4th of July", limit: 8 });
  });

  it("extracts a contact name and city", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Find the profile for Lisa in Dickinson", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Lisa", city: "Dickinson" });
  });

  it("maps state names to region searches", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Find profiles in Minnesota", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "MN", region: "MN" });
  });

  it("routes overdue follow-up discovery without arbitrary filters", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Who has overdue follow-ups?", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ overdueFollowUp: true });
  });

  it("accepts natural shorthand for who needs follow up", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Who need follow up", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "follow-up", overdueFollowUp: true, limit: 8 });
  });

  it("routes package-history discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Who usually books Pirate's Rebellion?", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ packageName: "Pirate's Rebellion" });
  });

  it("does not invent an unrestricted general query", async () => {
    const calls: ProfileSearchRequest[] = [];
    const result = await answerGeneralAssistant({ question: "Change all my bookings to confirmed", profileSearch: fakeRepo(calls) });
    expect(calls).toHaveLength(0);
    expect(result.kind).toBe("needs_context");
  });
});