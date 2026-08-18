import { describe, expect, it } from "vitest";
import { answerGeneralAssistant } from "./general-assistant";
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

describe("answerGeneralAssistant", () => {
  it("routes a named profile lookup to structured search", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Find Morton County Fair", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Morton County Fair", limit: 8 });
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

  it("routes package-history discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Who usually books Pirate's Rebellion?", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ packageName: "Pirate's Rebellion" });
  });

  it("treats a bare holiday event phrase as profile discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Christmas events", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Christmas", limit: 8 });
  });

  it("treats a bare festival/theme name as profile discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "Oktoberfest", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "Oktoberfest", limit: 8 });
  });

  it("keeps numbered holiday names intact for discovery", async () => {
    const calls: ProfileSearchRequest[] = [];
    await answerGeneralAssistant({ question: "4th of July", profileSearch: fakeRepo(calls) });
    expect(calls[0]).toMatchObject({ query: "4th of July", limit: 8 });
  });

  it("does not invent an unrestricted general query", async () => {
    const calls: ProfileSearchRequest[] = [];
    const result = await answerGeneralAssistant({ question: "Change all my bookings to confirmed", profileSearch: fakeRepo(calls) });
    expect(calls).toHaveLength(0);
    expect(result.kind).toBe("needs_context");
  });
});
