// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { ManagerAuthProvider,useManagerAuth } from "@/lib/manager-auth-context";
function Harness(){const a=useManagerAuth();return <button onClick={()=>a.signIn("00000000-0000-4000-8000-000000000001","pw")}>Manager sign in</button>;}
beforeEach(()=>{localStorage.clear();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({token:"manager-token",expiresAt:"2099-01-01T00:00:00Z",manager:{legId:"00000000-0000-4000-8000-000000000001",legName:"Leg 1",managerName:"Pat"}}),{status:200,headers:{"Content-Type":"application/json"}})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("manager authentication",()=>{
  it("stores manager auth separately and never unlocks owner auth",async()=>{render(<ManagerAuthProvider><Harness/></ManagerAuthProvider>);fireEvent.click(screen.getByRole("button",{name:"Manager sign in"}));await waitFor(()=>expect(localStorage.getItem("az_manager_token")).toBe("manager-token"));expect(localStorage.getItem("az_owner_token")).toBeNull();});
});
