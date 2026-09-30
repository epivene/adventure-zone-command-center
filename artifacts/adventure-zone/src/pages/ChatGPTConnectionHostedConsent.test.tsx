import { afterEach, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import {
  consentHtml,
  consentScript,
} from "../../../api-server/src/features/chatgpt-connection/consent-page";
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
it("uses existing login, defaults to read only, and submits exact consent without persisting credentials", async () => {
  window.history.replaceState(
    {},
    "",
    "/chatgpt-connection/consent?interaction=bound",
  );
  document.body.innerHTML = consentHtml("test");
  const fetch = vi.fn(async (path: string, options: any) => {
    if (path === "/api/auth/login") {
      expect(JSON.parse(options.body)).toEqual({ password: "owner-password" });
      return new Response(JSON.stringify({ token: "owner-token" }));
    }
    expect(options.headers.Authorization).toBe("Bearer owner-token");
    expect(options.credentials).toBe("same-origin");
    return new Response(
      JSON.stringify(
        options.method === "POST"
          ? { redirectTo: "https://evil.example/" }
          : {
              clientName: "<script>untrusted</script>",
              redirectUri: "https://client.example/cb",
              requestedScopes: ["crm:read", "crm:append"],
              csrfToken: "csrf",
            },
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  window.eval(consentScript);
  fireEvent.change(screen.getByLabelText("Owner password"), {
    target: { value: "owner-password" },
  });
  fireEvent.submit(document.getElementById("login")!);
  await screen.findByText("<script>untrusted</script>");
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes[0].checked).toBe(true);
  expect(boxes[1].checked).toBe(false);
  expect(
    (screen.getByLabelText("Owner password") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.click(
    screen.getByRole("button", { name: "Allow selected permissions" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Invalid authorization redirect",
    ),
  );
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    approve: true,
    scopes: ["crm:read"],
  });
  expect(fetch.mock.calls[2][1].headers["X-Connection-CSRF"]).toBe("csrf");
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({
    approve: false,
    scopes: ["crm:read"],
  });
  expect(document.body.textContent).not.toContain("owner-token");
});
