type PostListenStartupInput = {
  runMaintenance: () => Promise<void>;
  startBackgroundWorkers: () => Promise<void>;
  onMaintenanceError: (error: unknown) => void;
  onReady: () => void | Promise<void>;
};

export async function runMaintenanceAndStartWorkers(
  input: PostListenStartupInput,
): Promise<void> {
  await input.onReady();
  try {
    await input.runMaintenance();
  } catch (error) {
    input.onMaintenanceError(error);
  }
  await input.startBackgroundWorkers();
}
