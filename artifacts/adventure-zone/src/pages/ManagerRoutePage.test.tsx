// @vitest-environment jsdom
import { cleanup,render,screen,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import ManagerRoutePage from "./ManagerRoutePage";

const nextEvent={bookingId:"next",bookingName:"Next Fair",city:"Fargo",region:"ND",latitude:46.8772,longitude:-96.7898,startsAt:"2026-08-17T12:00:00Z",endsAt:"2026-08-19T12:00:00Z",operationalStartsAt:"2026-08-14T00:00:00Z",operationalEndsAt:"2026-08-22T23:59:00Z",status:"confirmed",probability:"definite",scheduleState:"booked"} as const;
const api=vi.fn(async()=>({route:{trip:{id:"t",name:"Dakotas",startLabel:"Home",startLatitude:47,startLongitude:-103,endLabel:"Fargo",endLatitude:46.8772,endLongitude:-96.7898,mpg:10,fuelPricePerGallon:3.5},stops:[{...nextEvent,id:"stop-next",sortOrder:1}],segments:[{id:"seg-next",fromLabel:"Home",toLabel:"Fargo",effectiveMiles:120,effectiveMinutes:150}]},events:[nextEvent],nextEvent}));
vi.mock("@/lib/manager-auth-context",()=>({useManagerAuth:()=>({managerApi:api})}));
vi.mock("@/features/manager-assistant/manager-assistant-context",()=>({useManagerAssistant:()=>({activeContext:null,setActiveContext:vi.fn(),open:false,openAssistant:vi.fn(),closeAssistant:vi.fn(),prefill:""})}));
vi.mock("@/features/manager/use-manager-scoped-map",()=>({useManagerScopedMap:()=>({loading:false,error:null,reload:vi.fn(),data:{leg:{id:"k",name:"Kristy",color:"#f97316"},route:null,events:[{bookingId:"b",bookingName:"Fair",city:"Fargo",region:"ND",latitude:46.8,longitude:-96.8,startsAt:new Date("2026-08-16T12:00:00Z"),endsAt:null,status:"confirmed"}],meetups:[]}})}));
vi.mock("@/components/manager/manager-scoped-map",()=>({ManagerScopedMap:({variant}:{variant:string})=><div aria-label="Manager events map">{variant}</div>}));
afterEach(cleanup);

describe("ManagerRoutePage",()=>{
  it("renders leg-assigned scheduled events from the manager-scoped map feed",async()=>{render(<ManagerRoutePage/>);await waitFor(()=>expect(screen.getByText("Fair")).toBeInTheDocument());expect(screen.getByText(/view only/i)).toBeInTheDocument();expect(screen.queryByRole("button",{name:/edit|save/i})).not.toBeInTheDocument();expect(screen.getByText(/Report Schedule\/Route Issue/i)).toBeInTheDocument();});
  it("shows the compact manager-scoped events map",async()=>{render(<ManagerRoutePage/>);expect(await screen.findByLabelText("Manager events map")).toHaveTextContent("events");});
  it("offers directions and travel estimates to the next event from the map area",async()=>{render(<ManagerRoutePage/>);const link=await screen.findByRole("link",{name:"Get directions"});expect(link).toHaveAttribute("href",expect.stringContaining("destination=46.8772%2C-96.7898"));expect(screen.getByText("120 mi")).toBeInTheDocument();expect(screen.getByText("2 hr 30 min")).toBeInTheDocument();expect(screen.getByText("$42.00 estimated gas")).toBeInTheDocument();expect(screen.getAllByText(/Buffer before:/).some((row) => /Aug 14.*Aug 16/.test(row.textContent ?? ""))).toBe(true);expect(screen.getAllByText(/Buffer after:/).some((row) => /Aug 20.*Aug 22/.test(row.textContent ?? ""))).toBe(true);expect(screen.getByText(/Select the event to open details and focus its map marker/i)).toBeInTheDocument();});
  it("does not expose another leg event",async()=>{render(<ManagerRoutePage/>);await screen.findByLabelText("Manager events map");expect(screen.queryByText("Hulk private event")).not.toBeInTheDocument();});
});
