export type PhoneLaunchInput = {
  number: string;
  extension?: string | null;
};

export function buildTelHref(input: PhoneLaunchInput) {
  const normalized = input.number.trim().startsWith("+")
    ? `+${input.number.replace(/\D/g, "")}`
    : input.number.replace(/\D/g, "");
  return `tel:${normalized}`;
}

type ClipboardTarget = {
  writeText(value: string): Promise<void> | void;
};

type OpenTarget = (
  url: string,
  target: string,
  features?: string,
) => Window | null | void;

export async function launchIndividualVoicemail({
  number,
  launcherUrl,
  clipboard,
  open = window.open.bind(window),
}: {
  number: string;
  launcherUrl: string | null;
  clipboard: ClipboardTarget;
  open?: OpenTarget;
}): Promise<{ launched: boolean; delivery: "unknown" }> {
  if (!launcherUrl) return { launched: false, delivery: "unknown" };
  await clipboard.writeText(number);
  open(launcherUrl, "_blank", "noopener,noreferrer");
  return { launched: true, delivery: "unknown" };
}
