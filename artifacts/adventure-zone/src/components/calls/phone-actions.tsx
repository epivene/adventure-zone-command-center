"use client";

import { useState } from "react";
import { PhoneCall } from "lucide-react";

import type { ContactPhoneRecord } from "@/features/contact-phones/contact-phone-types";
import {
  buildTelHref,
  launchIndividualVoicemail,
} from "@/features/calls/phone-launcher";
import type { CallMethod } from "@/features/calls/call-types";

type ClipboardTarget = {
  writeText(value: string): Promise<void> | void;
};

export function PhoneActions({
  phone,
  assistedCallingEnabled = false,
  voicemailLauncherUrl,
  clipboard = navigator.clipboard,
  onSelectMethod,
}: {
  phone: ContactPhoneRecord;
  assistedCallingEnabled?: boolean;
  voicemailLauncherUrl: string | null;
  clipboard?: ClipboardTarget;
  onSelectMethod?: (method: CallMethod) => void;
}) {
  const [status, setStatus] = useState("");
  const suppressed = Boolean(phone.doNotCallAt);

  async function copy(value: string, message: string) {
    await clipboard.writeText(value);
    setStatus(message);
  }

  function call(method: CallMethod) {
    onSelectMethod?.(method);
    window.location.assign(buildTelHref(phone));
  }

  async function voicemail() {
    onSelectMethod?.("individual_voicemail");
    const result = await launchIndividualVoicemail({
      number: phone.number,
      launcherUrl: voicemailLauncherUrl,
      clipboard,
    });
    setStatus(
      result.launched
        ? "Number copied. Continue in the opened app."
        : "Voicemail launch is not configured.",
    );
  }

  const voicemailAvailable =
    assistedCallingEnabled && Boolean(voicemailLauncherUrl);

  return (
    <div className="grid gap-2">
      {suppressed ? (
        <p className="text-sm font-semibold text-rose-700">
          Calling is unavailable for this number.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!suppressed && phone.type === "office" ? (
          <>
            <button className="button-primary inline-flex min-h-11 items-center gap-2" onClick={() => call("office_call")} type="button">
              <PhoneCall className="h-4 w-4" /> Call office
            </button>
            {phone.extension ? (
              <button
                className="button-secondary"
                onClick={() => void copy(phone.extension!, "Extension copied.")}
                type="button"
              >
                Use extension
              </button>
            ) : null}
          </>
        ) : null}
        {!suppressed && phone.type !== "office" ? (
          <button className="button-primary inline-flex min-h-11 items-center gap-2" onClick={() => call("standard_call")} type="button">
            <PhoneCall className="h-4 w-4" /> Call
          </button>
        ) : null}
        {!suppressed && phone.type !== "office" && voicemailAvailable ? (
          <button className="button-secondary" onClick={() => void voicemail()} type="button">
            Leave voicemail
          </button>
        ) : null}
        {phone.number ? (
          <button
            className="button-secondary"
            onClick={() => void copy(phone.number, "Number copied.")}
            type="button"
          >
            Copy number
          </button>
        ) : null}
      </div>
      {phone.type === "unknown" && !suppressed ? (
        <p className="text-xs text-amber-800">May not work for office numbers.</p>
      ) : null}
      {status ? <p className="text-sm text-slate-600" role="status">{status}</p> : null}
    </div>
  );
}
