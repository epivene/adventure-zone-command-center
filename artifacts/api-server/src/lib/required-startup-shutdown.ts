const DEFAULT_REQUIRED_STARTUP_SHUTDOWN_TIMEOUT_MS = 10_000;

export async function exitAfterRequiredStartupFailure(options: {
  shutdown: () => Promise<unknown>;
  exit: (code: number) => never;
  timeoutMs?: number;
}): Promise<never> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(
      resolve,
      options.timeoutMs ?? DEFAULT_REQUIRED_STARTUP_SHUTDOWN_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([options.shutdown(), deadline]);
  } catch {
    // Shutdown stages report their own errors. Failed startup must still exit.
  } finally {
    if (timer) clearTimeout(timer);
  }

  return options.exit(1);
}
