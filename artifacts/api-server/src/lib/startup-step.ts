import { logger } from "./logger";

const DEFAULT_STARTUP_STEP_TIMEOUT_MS = 30_000;

export async function runStartupStep<T>(
  name: string,
  work: () => Promise<T>,
  timeoutMs = DEFAULT_STARTUP_STEP_TIMEOUT_MS,
  onTimeout?: (error: Error) => void,
): Promise<T> {
  logger.info({ startupStep: name, timeoutMs }, "Startup step started");

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Startup step timed out: ${name}`);
        try {
          onTimeout?.(error);
        } catch (cancellationError) {
          logger.error(
            { err: cancellationError, startupStep: name },
            "Startup step timeout cancellation failed",
          );
        }
        reject(error);
      }, timeoutMs);
    });

    const result = await Promise.race([work(), timeout]);
    logger.info({ startupStep: name }, "Startup step completed");
    return result;
  } catch (error) {
    logger.error({ err: error, startupStep: name }, "Startup step failed");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
