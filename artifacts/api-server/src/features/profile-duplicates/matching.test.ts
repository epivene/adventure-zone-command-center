import { expect, it } from "vitest";
import { setImmediate } from "node:timers";
import {
  findPairs,
  findPairsAsync,
  scorePair,
  type MatchProfile,
} from "./matching";
const profiles: MatchProfile[] = [
  {
    id: "a",
    name: "Sweetwater County Fair",
    city: "Rock Springs",
    region: "WY",
  },
  {
    id: "b",
    name: "Sweetwater County Fair - Wyoming's Big Show",
    city: "Rock Springs",
    region: "WY",
  },
  { id: "c", name: "Wyoming's Big Show", city: "Rock Springs", region: "WY" },
  {
    id: "d",
    name: "County Fair - Wyoming State Fair (Douglas) WY",
    city: "Douglas",
    region: "WY",
  },
  { id: "e", name: "Wyoming State Fair", city: "Douglas", region: "WY" },
  { id: "f", name: "Wyoming State Fair", city: "Other Town", region: "CO" },
  { id: "g", name: "Winter Festival 2026", city: "Douglas", region: "WY" },
  { id: "h", name: "Winter Festival 2027", city: "Douglas", region: "WY" },
  { id: "i", name: "Summer Festival 2026", city: "Douglas", region: "WY" },
  { id: "j", name: "County Fair", city: null, region: null },
  { id: "k", name: "Balloon Balloon Festival", city: "Douglas", region: "WY" },
  { id: "l", name: "Balloon Festival", city: "Douglas", region: "WY" },
];
it("preserves all scores, reasons, order and dismissals in the cooperative scan", async () => {
  const dismissed = new Set(["a:b", "d:e"]);
  const expected = profiles
    .flatMap((left, i) =>
      profiles.slice(i + 1).flatMap((right) => {
        const pair = scorePair(left, right);
        return pair && !dismissed.has(left.id + ":" + right.id) ? [pair] : [];
      }),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.left.id.localeCompare(b.left.id) ||
        a.right.id.localeCompare(b.right.id),
    );
  expect(findPairs([...profiles].reverse(), dismissed)).toEqual(expected);
  expect(await findPairsAsync([...profiles].reverse(), dismissed)).toEqual(
    expected,
  );
});
it("serves another event-loop task before a large scan finishes", async () => {
  const word = (i: number) =>
    (Math.imul(i + 1, 2654435761) >>> 0).toString(36).padStart(7, "x");
  const large = Array.from({ length: 1500 }, (_, i) => ({
    id: String(i).padStart(8, "0"),
    name: word(i) + " " + word(i + 1500) + " Festival",
    city: "Town " + i,
    region: "CO",
  }));
  let served = false;
  setImmediate(() => {
    served = true;
  });
  const pairs = await findPairsAsync(large);
  expect(served).toBe(true);
  expect(pairs).toEqual([]);
}, 30000);
