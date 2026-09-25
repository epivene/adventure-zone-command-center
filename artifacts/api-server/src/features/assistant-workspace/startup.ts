export type WorkspaceStartupState = "starting" | "ready" | "failed" | "stopped";

// Separate from app-wide health: optional maintenance may fail after HTTP starts.
export function createWorkspaceStartup() {
  let state: WorkspaceStartupState = "starting";
  let initialized = false;
  return {
    state: () => state,
    async initialize(work: () => Promise<void>) {
      initialized = false;
      state = "starting";
      try {
        await work();
        initialized = true;
      } catch (error) {
        state = "failed";
        throw error;
      }
    },
    start(startWorker: () => () => void) {
      if (!initialized || state !== "starting") return () => {};
      try {
        const stop = startWorker();
        state = "ready";
        return () => {
          state = "stopped";
          stop();
        };
      } catch (error) {
        state = "failed";
        throw error;
      }
    },
  };
}
export const workspaceStartup = createWorkspaceStartup();
