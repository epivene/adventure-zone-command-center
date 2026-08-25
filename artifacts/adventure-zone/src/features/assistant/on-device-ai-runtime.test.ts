// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetOnDeviceAiForTests,
  __setOnDeviceAiModuleLoaderForTests,
  embedLocalTexts,
  getOnDeviceAiState,
  initializeOnDeviceAi,
  isOnDeviceAiEnabled,
  setOnDeviceAiEnabled,
  subscribeOnDeviceAi,
} from "./on-device-ai-runtime";

function mockModule(options?: { fail?: boolean }) {
  const pipelineRun = vi.fn(async (texts: string[]) => ({
    tolist: () => texts.map((_, index) => [index + 1, 0.5]),
  }));
  const pipeline = options?.fail
    ? vi.fn(async () => { throw new Error("model failed"); })
    : vi.fn(async (_task: string, _model: string, config: Record<string, unknown>) => {
        const callback = config.progress_callback as ((value: Record<string, unknown>) => void) | undefined;
        callback?.({ status: "progress", progress: 42, file: "model.onnx" });
        return pipelineRun;
      });
  return {
    module: {
      env: {
        useBrowserCache: false,
        allowRemoteModels: false,
        allowLocalModels: true,
      },
      pipeline,
    },
    pipeline,
    pipelineRun,
  };
}

describe("on-device AI runtime", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetOnDeviceAiForTests();
  });

  afterEach(() => {
    __resetOnDeviceAiForTests();
    localStorage.clear();
  });

  it("does not load the runtime or model while disabled", async () => {
    const mocked = mockModule();
    const loader = vi.fn(async () => mocked.module);
    __setOnDeviceAiModuleLoaderForTests(loader);

    expect(isOnDeviceAiEnabled()).toBe(false);
    expect(getOnDeviceAiState().status).toBe("disabled");
    await expect(embedLocalTexts(["hello"])).rejects.toThrow(/disabled/i);
    expect(loader).not.toHaveBeenCalled();
  });

  it("stores enable preference but waits for explicit initialization before loading", async () => {
    const mocked = mockModule();
    const loader = vi.fn(async () => mocked.module);
    __setOnDeviceAiModuleLoaderForTests(loader);

    setOnDeviceAiEnabled(true);
    expect(localStorage.getItem("adventure-zone:on-device-ai:enabled")).toBe("true");
    expect(getOnDeviceAiState().status).toBe("available");
    expect(loader).not.toHaveBeenCalled();

    await initializeOnDeviceAi();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mocked.pipeline).toHaveBeenCalledTimes(1);
    expect(getOnDeviceAiState().status).toBe("ready");
  });

  it("loads the pipeline only once and returns embedding rows", async () => {
    const mocked = mockModule();
    const loader = vi.fn(async () => mocked.module);
    __setOnDeviceAiModuleLoaderForTests(loader);
    setOnDeviceAiEnabled(true);

    await initializeOnDeviceAi();
    await initializeOnDeviceAi();
    const rows = await embedLocalTexts(["power", "water"]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(mocked.pipeline).toHaveBeenCalledTimes(1);
    expect(mocked.pipelineRun).toHaveBeenCalledWith(["power", "water"], {
      pooling: "mean",
      normalize: true,
    });
    expect(rows).toEqual([[1, 0.5], [2, 0.5]]);
  });

  it("publishes loading progress to subscribers", async () => {
    const mocked = mockModule();
    __setOnDeviceAiModuleLoaderForTests(async () => mocked.module);
    const states: string[] = [];
    const progress: Array<number | null> = [];
    const unsubscribe = subscribeOnDeviceAi((state) => {
      states.push(state.status);
      progress.push(state.progress);
    });

    setOnDeviceAiEnabled(true);
    await initializeOnDeviceAi();
    unsubscribe();

    expect(states).toContain("loading");
    expect(progress).toContain(42);
    expect(states.at(-1)).toBe("ready");
  });

  it("records initialization errors without breaking the caller", async () => {
    const mocked = mockModule({ fail: true });
    __setOnDeviceAiModuleLoaderForTests(async () => mocked.module);
    setOnDeviceAiEnabled(true);

    await expect(initializeOnDeviceAi()).resolves.toBeUndefined();
    expect(getOnDeviceAiState()).toMatchObject({
      status: "error",
      message: "model failed",
    });
    await expect(embedLocalTexts(["power"])).rejects.toThrow(/model failed|not ready/i);
  });

  it("turning off prevents future inference without requiring cache deletion", async () => {
    const mocked = mockModule();
    __setOnDeviceAiModuleLoaderForTests(async () => mocked.module);
    setOnDeviceAiEnabled(true);
    await initializeOnDeviceAi();
    setOnDeviceAiEnabled(false);

    expect(localStorage.getItem("adventure-zone:on-device-ai:enabled")).toBe("false");
    expect(getOnDeviceAiState().status).toBe("disabled");
    await expect(embedLocalTexts(["power"])).rejects.toThrow(/disabled/i);

    setOnDeviceAiEnabled(true);
    expect(getOnDeviceAiState().status).toBe("ready");
    expect(mocked.pipeline).toHaveBeenCalledTimes(1);
  });
});
