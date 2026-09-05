export async function withGoogleTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const delay = Math.max(1, Math.trunc(timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("GOOGLE_WORKSPACE_OPERATION_TIMEOUT")),
        delay,
      );
      operation.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
