// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerOperationsPage from "./ManagerOperationsPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string) => {
    if (path === "/manager/dashboard") return { trips: [], route: null };
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: mocks.api }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: vi.fn(async () => {}), flushManagerMutationQueue: vi.fn(async () => {}),
}));
vi.mock("@/features/manager/use-manager-scoped-map",()=>({useManagerScopedMap:()=>({loading:false,error:null,reload:vi.fn(),data:{leg:{id:"leg-a",name:"Kristy",color:"#f97316"},route:null,events:[],meetups:[]}})}));
vi.mock("@/components/manager/manager-scoped-map",()=>({ManagerScopedMap:({variant}:{variant:string})=><div aria-label="Manager operations map">{variant}</div>}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerOperationsPage", () => {
  it("shows the full manager operations map", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByLabelText("Manager operations map")).toHaveTextContent("operations");
  });

  it("allows mileage and maintenance entries even when there is no trip", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Mileage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
    expect(screen.queryByText("No current trip.")).not.toBeInTheDocument();
  });
});
