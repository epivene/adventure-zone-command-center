const ENABLED_KEY = "adventure-zone:on-device-ai:enabled";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";

export type OnDeviceAiStatus =
  | "disabled"
  | "available"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export type OnDeviceAiProgress = {
  status: OnDeviceAiStatus;
  progress: number | null;
  message: string | null;
};

type TensorLike = {
  data?: ArrayLike<number>;
  dims?: number[];
  tolist?: () => unknown;
};

type FeaturePipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<TensorLike>;

type TransformersModule = {
  env: {
    useBrowserCache?: boolean;
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
  };
  pipeline: (
    task: string,
    model: string,
    options?: {
      dtype?: "q4";
      progress_callback?: (info: Record<string, unknown>) => void;
    },
  ) => Promise<FeaturePipeline>;
};

type ModuleLoader = () => Promise<TransformersModule>;

const listeners = new Set<(state: OnDeviceAiProgress) => void>();
let pipelineInstance: FeaturePipeline | null = null;
let initialization: Promise<void> | null = null;

function browserAvailable() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function storedEnabled() {
  if (!browserAvailable()) return false;
  try { return localStorage.getItem(ENABLED_KEY) === "true"; }
  catch { return false; }
}

let state: OnDeviceAiProgress = browserAvailable()
  ? { status: storedEnabled() ? "available" : "disabled", progress: null, message: null }
  : { status: "unavailable", progress: null, message: "On-device AI requires a browser." };

function emit(next: OnDeviceAiProgress) {
  state = next;
  for (const listener of listeners) listener({ ...state });
}

async function defaultModuleLoader(): Promise<TransformersModule> {
  return import(/* @vite-ignore */ TRANSFORMERS_CDN) as Promise<TransformersModule>;
}

let moduleLoader: ModuleLoader = defaultModuleLoader;

function errorMessage(cause: unknown) {
  return cause instanceof Error && cause.message.trim()
    ? cause.message.trim().slice(0, 300)
    : "On-device AI could not be initialized.";
}

function progressFrom(info: Record<string, unknown>) {
  const raw = Number(info.progress);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, raw));
}

function rowsFromTensor(value: TensorLike, expectedRows: number): number[][] {
  const listed = value.tolist?.();
  if (Array.isArray(listed)) {
    if (listed.length === 0) return [];
    if (Array.isArray(listed[0])) {
      return listed.slice(0, expectedRows).map((row) =>
        Array.isArray(row) ? row.map((item) => Number(item)) : [],
      );
    }
    if (expectedRows === 1) return [listed.map((item) => Number(item))];
  }

  const data = value.data ? Array.from(value.data, Number) : [];
  if (!data.length || expectedRows <= 0) return [];
  const dimensions = Array.isArray(value.dims) ? value.dims : [];
  const rows = dimensions.length >= 2 && Number.isFinite(dimensions[0])
    ? Math.max(1, Math.min(expectedRows, Number(dimensions[0])))
    : expectedRows;
  const width = Math.floor(data.length / rows);
  if (width <= 0) return [];
  return Array.from({ length: rows }, (_, row) =>
    data.slice(row * width, row * width + width),
  );
}

export function isOnDeviceAiEnabled() {
  return storedEnabled();
}

export function getOnDeviceAiState(): OnDeviceAiProgress {
  return { ...state };
}

export function subscribeOnDeviceAi(listener: (state: OnDeviceAiProgress) => void) {
  listeners.add(listener);
  listener({ ...state });
  return () => { listeners.delete(listener); };
}

export function setOnDeviceAiEnabled(enabled: boolean) {
  if (!browserAvailable()) {
    emit({ status: "unavailable", progress: null, message: "On-device AI requires a browser." });
    return;
  }
  try { localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false"); }
  catch { /* Preference persistence is best-effort. */ }
  if (!enabled) {
    emit({ status: "disabled", progress: null, message: null });
    return;
  }
  emit({
    status: pipelineInstance ? "ready" : "available",
    progress: null,
    message: pipelineInstance ? "On-device matching is ready." : null,
  });
}

export async function initializeOnDeviceAi(): Promise<void> {
  if (!isOnDeviceAiEnabled()) {
    emit({ status: "disabled", progress: null, message: null });
    return;
  }
  if (!browserAvailable()) {
    emit({ status: "unavailable", progress: null, message: "On-device AI requires a browser." });
    return;
  }
  if (pipelineInstance) {
    emit({ status: "ready", progress: null, message: "On-device matching is ready." });
    return;
  }
  if (initialization) return initialization;

  emit({ status: "loading", progress: null, message: "Loading on-device AI…" });
  initialization = (async () => {
    try {
      const transformers = await moduleLoader();
      transformers.env.useBrowserCache = true;
      transformers.env.allowRemoteModels = true;
      transformers.env.allowLocalModels = false;
      pipelineInstance = await transformers.pipeline(
        "feature-extraction",
        MODEL_ID,
        {
          dtype: "q4",
          progress_callback: (info) => {
            if (state.status !== "loading") return;
            const file = typeof info.file === "string" ? info.file : null;
            emit({
              status: "loading",
              progress: progressFrom(info),
              message: file ? `Loading ${file}` : "Loading on-device AI…",
            });
          },
        },
      );
      emit({ status: "ready", progress: null, message: "On-device matching is ready." });
    } catch (cause) {
      pipelineInstance = null;
      emit({ status: "error", progress: null, message: errorMessage(cause) });
    } finally {
      initialization = null;
    }
  })();
  return initialization;
}

export async function embedLocalTexts(texts: string[]): Promise<number[][]> {
  if (!isOnDeviceAiEnabled()) throw new Error("On-device AI is disabled.");
  if (!pipelineInstance) await initializeOnDeviceAi();
  if (!pipelineInstance || state.status !== "ready") {
    throw new Error(state.message || "On-device AI is not ready.");
  }
  const cleaned = texts.map((text) => text.trim()).filter(Boolean);
  if (!cleaned.length) return [];
  const output = await pipelineInstance(cleaned, { pooling: "mean", normalize: true });
  return rowsFromTensor(output, cleaned.length);
}

export function __setOnDeviceAiModuleLoaderForTests(loader: ModuleLoader) {
  moduleLoader = loader;
}

export function __resetOnDeviceAiForTests() {
  pipelineInstance = null;
  initialization = null;
  listeners.clear();
  moduleLoader = defaultModuleLoader;
  state = browserAvailable()
    ? { status: storedEnabled() ? "available" : "disabled", progress: null, message: null }
    : { status: "unavailable", progress: null, message: "On-device AI requires a browser." };
}
