import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const get=vi.hoisted(()=>vi.fn(async()=>({count:3})));
vi.mock("@/lib/auth-token",()=>({apiGet:get}));
import { useDocumentReviewCount } from "./use-document-review-count";
afterEach(cleanup);
function Badge(){return <span>Count: {useDocumentReviewCount()}</span>;}
it("shares one request across desktop and mobile menus and applies review changes to both",async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={client}><Badge/><Badge/></QueryClientProvider>);
 await waitFor(()=>expect(screen.getAllByText("Count: 3")).toHaveLength(2));
 expect(get).toHaveBeenCalledTimes(1);
 act(()=>window.dispatchEvent(new CustomEvent("business-document-review-count-changed",{detail:1})));
 await waitFor(()=>expect(screen.getAllByText("Count: 1")).toHaveLength(2));
 expect(get).toHaveBeenCalledTimes(1);
 client.clear();
});
