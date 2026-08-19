import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, list, resolve } = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/features/needs-answer/needs-answer-repository", () => ({
  NeedsAnswerRepository: class {
    create = create;
    list = list;
    resolve = resolve;
  },
}));

import needsAnswerRouter from "./needs-answer";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(needsAnswerRouter);
  return instance;
}

const item = {
  id: "80000000-0000-4000-8000-000000000001",
  question: "What is the confirmed setup requirement for this package?",
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  bookingId: "30000000-0000-4000-8000-000000000001",
  followUpId: "60000000-0000-4000-8000-000000000001",
  callSessionId: null,
  userNote: null,
  status: "open",
  resolution: null,
  createdAt: "2026-08-19T20:00:00.000Z",
  updatedAt: "2026-08-19T20:00:00.000Z",
  resolvedAt: null,
};

beforeEach(() => {
  create.mockReset();
  list.mockReset();
  resolve.mockReset();
});

describe("Needs Answer routes", () => {
  it("saves an unresolved call question with its CRM context", async () => {
    create.mockResolvedValue(item);

    const response = await request(app())
      .post("/needs-answer")
      .send({
        question: item.question,
        organizationId: item.organizationId,
        contactId: item.contactId,
        bookingId: item.bookingId,
        followUpId: item.followUpId,
      })
      .expect(201);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      question: item.question,
      organizationId: item.organizationId,
      followUpId: item.followUpId,
    }));
    expect(response.body.item).toEqual(item);
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain("send to admin");
  });

  it("lists only the requested status", async () => {
    list.mockResolvedValue([item]);

    const response = await request(app())
      .get("/needs-answer?status=open")
      .expect(200);

    expect(list).toHaveBeenCalledWith("open");
    expect(response.body.items).toEqual([item]);
  });

  it("resolves an open question with the administrator's confirmed answer", async () => {
    const resolved = {
      ...item,
      status: "resolved",
      resolution: "Use the confirmed setup requirement stored in Packages & Resources.",
      resolvedAt: "2026-08-19T21:00:00.000Z",
    };
    resolve.mockResolvedValue(resolved);

    const response = await request(app())
      .post(`/needs-answer/${item.id}/resolve`)
      .send({ resolution: resolved.resolution })
      .expect(200);

    expect(resolve).toHaveBeenCalledWith(item.id, resolved.resolution);
    expect(response.body.item.status).toBe("resolved");
  });
});
