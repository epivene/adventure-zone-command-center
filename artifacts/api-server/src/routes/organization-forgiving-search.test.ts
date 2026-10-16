import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({
  match: "10000000-0000-4000-8000-000000000001",
  unrelated: "10000000-0000-4000-8000-000000000002",
  enrichedIds: [] as string[],
  corpusIds: [] as string[],
  broad: false,
}));
vi.mock("@workspace/db", () => ({ db: { execute: async () => ({ rows: [] }) } }));
vi.mock("@/features/organizations/organization-repository", () => ({
  DrizzleOrganizationRepository: class {
    organizationIdsQuery() { return [fixtures.match, fixtures.unrelated]; }
    async listOrganizations(_query: unknown, ids?: string[]) {
      fixtures.enrichedIds = ids ?? [fixtures.match, fixtures.unrelated];
      const records = fixtures.enrichedIds.map(id => ({ id, name: id === fixtures.match ? "Preston" : "Other", latestRecordedEventDate: { date: "2025-07-25", source: "festival_edition" } }));
      return { records, total: records.length, page: 1, pageSize: 25, pageCount: 1 };
    }
  },
}));
vi.mock("@/features/organizations/organization-search-corpus", () => ({
  loadOrganizationSearchCorpus: async (_db: unknown, ids: string[]) => { fixtures.corpusIds = ids; return fixtures.broad ? Array.from({length:80},(_,i)=>({id:String(i).padStart(3,"0"),searchText:"Fair"})) : [
    { id: fixtures.match, searchText: "Preston Rodeo" },
    { id: fixtures.unrelated, searchText: "Unrelated Fair" },
  ]; },
}));
vi.mock("@/features/event-families/event-family-list", () => ({
  attachEventFamiliesToOrganizationPage: async (_db: unknown, _query: unknown, page: any) => ({ organizations: page, families: [] }),
}));
vi.mock("@/features/routes/travel-leg-repository", () => ({
  DrizzleTravelLegRepository: class { async listTravelLegs() { return []; } },
}));
import router from "./organization-forgiving-search";

it("matches lightweight search candidates before loading bookings, contacts and dates", async () => {
  const app = express().use((_req, _res, next) => next()).use(router);
  const result = await request(app).get("/organizations?q=Preston");
  expect(result.status).toBe(200);
  expect(result.body.organizations.records.map((row: any) => row.id)).toEqual([fixtures.match]);
  expect(fixtures.enrichedIds).toEqual([fixtures.match]);
  expect(fixtures.corpusIds).toEqual([fixtures.match, fixtures.unrelated]);
  expect(result.body.organizations.records[0].latestRecordedEventDate).toEqual({ date: "2025-07-25", source: "festival_edition" });
});

it("loads only the requested page of a broad search while preserving totals", async () => {
  fixtures.broad=true;
  try {
    const result=await request(express().use(router)).get("/organizations?q=fair&page=2&pageSize=25");
    expect(result.status).toBe(200);
    expect(fixtures.enrichedIds).toHaveLength(25);
    expect(result.body.organizations).toMatchObject({total:80,page:2,pageSize:25,pageCount:4});
    expect(result.body.organizations.records.map((r:any)=>r.id)).toEqual(Array.from({length:25},(_,i)=>String(i+25).padStart(3,"0")));
  } finally { fixtures.broad=false; }
});
