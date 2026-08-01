// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCapture: vi.fn(),
  createPreview: vi.fn(),
  createReader: vi.fn(),
  getActEnvironment: vi.fn(),
  isActMigrationApplyEnabled: vi.fn(),
  getWorkspace: vi.fn(),
  receivedProps: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/env", () => ({
  getActEnvironment: mocks.getActEnvironment,
  isActMigrationApplyEnabled: mocks.isActMigrationApplyEnabled,
}));
vi.mock("@/features/act-migration/runtime", () => ({
  createActMigrationCaptureService: mocks.createCapture,
  createActMigrationPreviewService: mocks.createPreview,
  createActMigrationWorkspaceReader: mocks.createReader,
}));
vi.mock("@/components/act-migration/act-migration-review", () => ({
  ActMigrationReview: (props: {
    configured: boolean;
    maskedDatabase: string | null;
    query: unknown;
    workspace: unknown;
  }) => {
    mocks.receivedProps(props);
    return (
      <div data-testid="migration-review">
        {JSON.stringify({
          configured: props.configured,
          maskedDatabase: props.maskedDatabase,
          query: props.query,
        })}
      </div>
    );
  },
}));

import ActMigrationPage, {
  dynamic,
} from "@/app/(private)/settings/act-migration/page";

const runId = "11111111-1111-4111-8111-111111111111";
const workspace = {
  progress: {
    runId,
    status: "snapshotting" as const,
    completedCheckpoints: 0,
    totalCheckpoints: 4,
    stagedRecords: 0,
    failedCheckpoints: 0,
    retryable: false,
    retryAfter: null,
    streams: [],
    interruption: null,
  },
  preview: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ userId: "owner-1" });
  mocks.getActEnvironment.mockReturnValue({
    configured: true,
    config: {
      baseUrl: "https://example.invalid",
      databaseName: "CommandCenter3125",
      username: "raw-shared-user",
      password: "raw-shared-password",
    },
  });
  mocks.getWorkspace.mockResolvedValue(workspace);
  mocks.isActMigrationApplyEnabled.mockReturnValue(false);
  mocks.createReader.mockResolvedValue({
    getWorkspace: mocks.getWorkspace,
  });
});

afterEach(cleanup);

describe("Act migration page boundary", () => {
  it("is dynamic and awaits owner authorization before environment, URL, or reader access", async () => {
    let authorize!: (value: { userId: string }) => void;
    mocks.requireOwner.mockReturnValueOnce(
      new Promise((resolve) => {
        authorize = resolve;
      }),
    );
    const searchParamsThen = vi.fn((resolve: (value: object) => void) =>
      resolve({}));
    const searchParams = {
      then: searchParamsThen,
    } as unknown as Promise<Record<string, string | string[] | undefined>>;

    const pending = ActMigrationPage({ searchParams });

    expect(dynamic).toBe("force-dynamic");
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
    expect(searchParamsThen).not.toHaveBeenCalled();
    expect(mocks.createReader).not.toHaveBeenCalled();

    authorize({ userId: "owner-1" });
    render(await pending);

    expect(mocks.getActEnvironment).toHaveBeenCalledOnce();
    expect(searchParamsThen).toHaveBeenCalledOnce();
    expect(mocks.createReader).toHaveBeenCalledOnce();
    expect(mocks.getWorkspace).toHaveBeenCalledOnce();
  });

  it("uses exact safe defaults and treats an invalid run identifier as newest", async () => {
    render(await ActMigrationPage({
      searchParams: Promise.resolve({
        runId: "not-a-uuid",
        page: "1e2",
        pageSize: "101",
        targetEntityType: "company",
        state: "unsafe",
      }),
    }));

    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      runId: undefined,
      query: {
        page: 1,
        pageSize: 50,
      },
    });
    expect(mocks.receivedProps).toHaveBeenCalledWith(expect.objectContaining({
      query: {
        page: 1,
        pageSize: 50,
      },
      workspace,
    }));
  });

  it("accepts only bounded whole-number pages and known URL facets", async () => {
    render(await ActMigrationPage({
      searchParams: Promise.resolve({
        runId: [runId, "ignored"],
        page: ["1000000", "2"],
        pageSize: ["100", "50"],
        targetEntityType: ["contact", "organization"],
        state: ["needs_review", "new"],
      }),
    }));

    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      runId,
      query: {
        page: 1_000_000,
        pageSize: 100,
        targetEntityType: "contact",
        state: "needs_review",
      },
    });

    mocks.getWorkspace.mockClear();
    render(await ActMigrationPage({
      searchParams: Promise.resolve({
        page: "1000001",
        pageSize: "+50",
      }),
    }));
    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      runId: undefined,
      query: { page: 1, pageSize: 50 },
    });
  });

  it("reads stored PostgreSQL workspace with missing Act credentials", async () => {
    mocks.getActEnvironment.mockImplementationOnce(() => {
      throw new Error("ACT_API_PASSWORD is missing");
    });

    render(await ActMigrationPage({
      searchParams: Promise.resolve({ runId }),
    }));

    expect(mocks.createReader).toHaveBeenCalledOnce();
    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      runId,
      query: { page: 1, pageSize: 50 },
    });
    expect(mocks.receivedProps).toHaveBeenCalledWith(expect.objectContaining({
      configured: false,
      maskedDatabase: null,
      workspace,
    }));
    expect(mocks.createCapture).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
  });

  it("passes only a database mask with the last four characters visible", async () => {
    render(await ActMigrationPage({
      searchParams: Promise.resolve({}),
    }));

    const props = mocks.receivedProps.mock.calls[0]![0];
    expect(props.maskedDatabase).toMatch(/^•+3125$/);
    const rendered = screen.getByTestId("migration-review").textContent ?? "";
    expect(rendered).not.toContain("CommandCenter3125");
    expect(rendered).not.toContain("raw-shared-user");
    expect(rendered).not.toContain("raw-shared-password");
    expect(JSON.stringify(props)).not.toContain("CommandCenter3125");
    expect(JSON.stringify(props)).not.toContain("raw-shared-user");
    expect(JSON.stringify(props)).not.toContain("raw-shared-password");
  });

  it("fully masks database names that are four characters or shorter", async () => {
    mocks.getActEnvironment.mockReturnValueOnce({
      configured: true,
      config: {
        baseUrl: "https://example.invalid",
        databaseName: "ACT",
        username: "raw-shared-user",
        password: "raw-shared-password",
      },
    });

    render(await ActMigrationPage({
      searchParams: Promise.resolve({}),
    }));

    const props = mocks.receivedProps.mock.calls[0]![0];
    expect(props.maskedDatabase).toBe("••••");
    expect(JSON.stringify(props)).not.toContain("ACT");
  });
});
