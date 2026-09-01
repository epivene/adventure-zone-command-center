type PostListenStartupInput = {
  runMaintenance: () => Promise<void>;
  startBackgroundWorkers: () => Promise<void>;
  onMaintenanceError: (error: unknown) => void;
};

export async function runMaintenanceAndStartWorkers(
  input: PostListenStartupInput,
): Promise<void> {
  try {
    await input.runMaintenance();
  } catch (error) {
    input.onMaintenanceError(error);
  } finally {
    await input.startBackgroundWorkers();
  }
}
