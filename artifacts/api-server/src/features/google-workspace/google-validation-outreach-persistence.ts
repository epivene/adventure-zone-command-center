export async function persistMappedOutreachObservation(input: {
  observe(): Promise<void>;
  markProcessed(): Promise<void>;
}) {
  await input.observe();
  await input.markProcessed();
}
