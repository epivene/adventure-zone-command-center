// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  getOnDeviceAiState: vi.fn(),
  initializeOnDeviceAi: vi.fn(),
  setOnDeviceAiEnabled: vi.fn(),
  subscribeOnDeviceAi: vi.fn(),
}));

vi.mock("@/features/assistant/on-device-ai-runtime", () => runtime);

import { OnDeviceAiControl } from "./on-device-ai-control";

function state(status: "disabled" | "available" | "loading" | "ready" | "unavailable" | "error", overrides: Record<string, unknown> = {}) {
  return {
    status,
    progress: null,
    message: null,
    ...overrides,
  };
}

function installState(initial: ReturnType<typeof state>) {
  let listener: ((value: ReturnType<typeof state>) => void) | null = null;
  runtime.getOnDeviceAiState.mockReturnValue(initial);
  runtime.subscribeOnDeviceAi.mockImplementation((callback: (value: ReturnType<typeof state>) => void) => {
    listener = callback;
    callback(initial);
    return () => { listener = null; };
  });
  return {
    emit(value: ReturnType<typeof state>) { listener?.(value); },
  };
}

describe("OnDeviceAiControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.initializeOnDeviceAi.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("starts disabled without initializing or downloading anything", () => {
    installState(state("disabled"));
    render(<OnDeviceAiControl />);

    expect(screen.getByText("On-device AI")).toBeInTheDocument();
    expect(screen.getByText(/Free local matching on this device/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(runtime.initializeOnDeviceAi).not.toHaveBeenCalled();
  });

  it("enables and explicitly initializes only after the user clicks Enable", async () => {
    installState(state("disabled"));
    render(<OnDeviceAiControl />);

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(runtime.setOnDeviceAiEnabled).toHaveBeenCalledWith(true));
    expect(runtime.initializeOnDeviceAi).toHaveBeenCalledTimes(1);
  });

  it("shows loading progress", () => {
    installState(state("loading", { progress: 42, message: "Loading model.onnx" }));
    render(<OnDeviceAiControl />);

    expect(screen.getByText("Loading on-device AI…")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("Loading model.onnx")).toBeInTheDocument();
  });

  it("shows ready state and can turn local AI off", () => {
    installState(state("ready", { message: "On-device matching is ready." }));
    render(<OnDeviceAiControl />);

    expect(screen.getByText("On-device ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(runtime.setOnDeviceAiEnabled).toHaveBeenCalledWith(false);
  });

  it("shows a non-blocking error with retry", async () => {
    installState(state("error", { message: "Model download failed." }));
    render(<OnDeviceAiControl />);

    expect(screen.getByText("On-device AI unavailable")).toBeInTheDocument();
    expect(screen.getByText("Model download failed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(runtime.initializeOnDeviceAi).toHaveBeenCalledTimes(1));
  });
});
