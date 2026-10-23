import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/components/contacts/contact-list", () => ({
  ContactList: () => <div>Contact results</div>,
}));

import { ContactDirectoryView } from "./contact-directory-view";

const emptyPage = { records: [], total: 0, page: 1, pageCount: 1 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("ContactDirectoryView request pressure regression", () => {
  it("still loads when React verifies effects in Strict Mode", async () => {
    const first = deferred<typeof emptyPage>();
    apiGet.mockImplementationOnce(() => first.promise);
    apiGet.mockResolvedValue(emptyPage);

    render(
      <StrictMode>
        <ContactDirectoryView search="?q=Patrick" />
      </StrictMode>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    first.resolve(emptyPage);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it("runs one contacts request at a time and keeps only the latest queued URL", async () => {
    const first = deferred<typeof emptyPage>();
    apiGet.mockImplementationOnce(() => first.promise);
    apiGet.mockResolvedValue(emptyPage);

    const view = render(<ContactDirectoryView search="?q=Patr" />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    view.rerender(<ContactDirectoryView search="?q=Patri" />);
    view.rerender(<ContactDirectoryView search="?q=Patrick" />);
    expect(apiGet).toHaveBeenCalledTimes(1);

    first.resolve(emptyPage);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(apiGet).toHaveBeenLastCalledWith("/contacts?q=Patrick");
  });
});
