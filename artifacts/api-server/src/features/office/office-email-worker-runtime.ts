import type { OfficeEmailDispatcherLoop } from "./office-email-dispatcher-loop";

export type WorkerSignals = {
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): void;
  off(signal: "SIGTERM" | "SIGINT", listener: () => void): void;
};

export function startOfficeEmailWorkerRuntime(input: {
  loop: Pick<OfficeEmailDispatcherLoop, "start" | "stop">;
  signals?: WorkerSignals;
  close(): Promise<void>;
}) {
  const signals = input.signals ?? process;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (!stopping) {
      stopping = (async () => {
        input.loop.stop();
        signals.off("SIGTERM", stop);
        signals.off("SIGINT", stop);
        await input.close();
      })();
    }
    return stopping;
  };
  signals.on("SIGTERM", stop);
  signals.on("SIGINT", stop);
  input.loop.start();
  return { stop };
}
