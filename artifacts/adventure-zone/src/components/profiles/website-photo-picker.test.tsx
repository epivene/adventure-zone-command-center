import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WebsitePhotoPicker } from "./website-photo-picker";
import { apiGet } from "@/lib/auth-token";
vi.mock("@/lib/auth-token",()=>({apiGet:vi.fn()}));
it("previews website images and saves only the chosen image and source", async()=>{
 vi.mocked(apiGet).mockResolvedValue({images:[{url:"https://fair.example/logo.png",sourceUrl:"https://fair.example",dataUrl:"data:image/png;base64,YQ==",label:"Fair logo"}]});
 const saves:unknown[][]=[];
 render(<WebsitePhotoPicker profileId="profile" onSave={async(...args)=>{saves.push(args);}}/>);
 fireEvent.click(screen.getByText("Use website image"));
 await screen.findByAltText("Fair logo");
 expect(saves).toHaveLength(0);
 fireEvent.click(screen.getByRole("button",{name:/Fair logo/}));
 await waitFor(()=>expect(saves).toEqual([["data:image/png;base64,YQ==","https://fair.example/logo.png"]]));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
