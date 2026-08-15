// @vitest-environment jsdom
import { cleanup,render,screen,waitFor } from "@testing-library/react";import { afterEach,describe,expect,it,vi } from "vitest";import ManagerRoutePage from "./ManagerRoutePage";
const api=vi.fn(async()=>({route:{trip:{id:"t",name:"Dakotas",startLabel:"Home",endLabel:"Fargo"},stops:[],segments:[]},events:[{tripId:"t",bookingId:"b",bookingName:"Fair",city:"Fargo",region:"ND",startsAt:"2026-08-16T12:00:00Z"}],nextEvent:null}));
vi.mock("@/lib/manager-auth-context",()=>({useManagerAuth:()=>({managerApi:api})}));afterEach(cleanup);
describe("ManagerRoutePage",()=>{it("renders official schedule without edit controls",async()=>{render(<ManagerRoutePage/>);await waitFor(()=>expect(screen.getByText("Fair")).toBeInTheDocument());expect(screen.getByText(/view only/i)).toBeInTheDocument();expect(screen.queryByRole("button",{name:/edit|save/i})).not.toBeInTheDocument();expect(screen.getByText(/Report Schedule\/Route Issue/i)).toBeInTheDocument();});});
