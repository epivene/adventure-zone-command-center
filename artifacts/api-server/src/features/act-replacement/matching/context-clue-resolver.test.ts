import { describe, expect, it } from "vitest";
import {
  resolveContextClues,
  type ContextClueEvidence,
} from "./context-clue-resolver";

const clue = (
  family: ContextClueEvidence["family"],
  targetEntityId = "org-1",
  overrides: Partial<ContextClueEvidence> = {},
): ContextClueEvidence => ({
  family,
  label: `${family} agrees`,
  targetEntityType: "organization",
  targetEntityId,
  authority: "supporting",
  ...overrides,
});

describe("resolveContextClues", () => {
  it("does not resolve one supporting clue family", () => {
    expect(resolveContextClues([clue("identity")])).toEqual({
      kind: "none",
      reason: "insufficient_independent_context_clues",
      evidence: [clue("identity")],
    });
  });

  it("resolves two independent families that identify one target", () => {
    expect(resolveContextClues([
      clue("location"),
      clue("identity"),
    ])).toEqual({
      kind: "resolved",
      targetEntityType: "organization",
      targetEntityId: "org-1",
      reason: "two_independent_context_clues",
      evidence: [clue("identity"), clue("location")],
    });
  });

  it("counts multiple values from one family only once", () => {
    expect(resolveContextClues([
      clue("location", "org-1", { label: "city agrees" }),
      clue("location", "org-1", { label: "postal code agrees" }),
    ])).toEqual({
      kind: "none",
      reason: "insufficient_independent_context_clues",
      evidence: [clue("location", "org-1", { label: "city agrees" })],
    });
  });

  it("returns sorted candidates when two targets tie", () => {
    const result = resolveContextClues([
      clue("identity", "org-z"),
      clue("location", "org-z"),
      clue("identity", "org-a"),
      clue("location", "org-a"),
    ]);
    expect(result).toMatchObject({
      kind: "ambiguous",
      candidateIds: ["org-a", "org-z"],
      reason: "conflicting_context_clues",
    });
  });

  it("blocks a qualified target when another target has contradictory evidence", () => {
    const result = resolveContextClues([
      clue("identity", "org-1"),
      clue("location", "org-1"),
      clue("direct_contact", "org-2"),
    ]);
    expect(result).toMatchObject({
      kind: "ambiguous",
      candidateIds: ["org-1", "org-2"],
      reason: "conflicting_context_clues",
    });
  });

  it("allows one authoritative target without a second family", () => {
    expect(resolveContextClues([
      clue("identity", "org-9", {
        label: "exact Act link",
        authority: "authoritative",
      }),
    ])).toEqual({
      kind: "resolved",
      targetEntityType: "organization",
      targetEntityId: "org-9",
      reason: "authoritative_context_clue",
      evidence: [
        clue("identity", "org-9", {
          label: "exact Act link",
          authority: "authoritative",
        }),
      ],
    });
  });

  it("does not let an authoritative clue override contradictory supporting evidence", () => {
    expect(resolveContextClues([
      clue("identity", "org-1", {
        label: "exact Act link",
        authority: "authoritative",
      }),
      clue("location", "org-2"),
    ])).toMatchObject({
      kind: "ambiguous",
      candidateIds: ["org-1", "org-2"],
      reason: "conflicting_context_clues",
    });
  });

  it("is deterministic regardless of clue order", () => {
    const clues = [
      clue("web_identity", "org-1"),
      clue("identity", "org-1"),
      clue("location", "org-1"),
    ];
    expect(resolveContextClues(clues)).toEqual(
      resolveContextClues([...clues].reverse()),
    );
  });
});
