export interface IncomingAlertEnvironment {
  prepareSound(): Promise<void>;
  permission(): NotificationPermission | "unsupported";
  requestPermission(): Promise<NotificationPermission | "unsupported">;
  ring(): () => void;
  notify(id: string, onClick: () => void): () => void;
  reveal(): void;
}
const soundWarning = "Call alert sound is blocked. Click Test ringtone and notification, and check your speakers and site sound permissions.";
const notificationWarning = "Desktop notifications are blocked or unavailable. Allow notifications for Command Center in Edge; also check Windows Do Not Disturb.";
export function createIncomingCallAlerts(environment: IncomingAlertEnvironment) {
  let soundReady = false;
  let activeId: string | null = null;
  let silence: (() => void) | undefined;
  let close: (() => void) | undefined;
  function stop() {
    activeId = null;
    const oldSilence = silence; const oldClose = close;
    silence = undefined; close = undefined;
    try { oldSilence?.(); } finally { oldClose?.(); }
  }
  return {
    async prepare(): Promise<string[]> {
      // Both calls begin during the user's click, before awaiting permission.
      const sound = environment.prepareSound().then(() => { soundReady = true; }, error => { soundReady = false; throw error; });
      const permission = environment.permission() === "default"
        ? environment.requestPermission() : Promise.resolve(environment.permission());
      const [audio, desktop] = await Promise.allSettled([sound, permission]);
      soundReady = audio.status === "fulfilled";
      const warnings: string[] = [];
      if (!soundReady) warnings.push(soundWarning);
      if (desktop.status !== "fulfilled" || desktop.value !== "granted") warnings.push(notificationWarning);
      return warnings;
    },
    start(id: string): string[] {
      if (activeId === id) return [];
      stop(); activeId = id;
      const warnings: string[] = [];
      if (soundReady) {
        try { silence = environment.ring(); } catch { warnings.push(soundWarning); }
      } else warnings.push(soundWarning);
      if (environment.permission() === "granted") {
        try { close = environment.notify(id, () => environment.reveal()); }
        catch { warnings.push(notificationWarning); }
      } else warnings.push(notificationWarning);
      return warnings;
    },
    stop,
  };
}

export function createBrowserIncomingAlertEnvironment(): IncomingAlertEnvironment {
  let audio: AudioContext | undefined;
  return {
    async prepareSound() {
      audio ??= new AudioContext();
      await audio.resume();
      if (audio.state !== "running") throw new Error("Audio is suspended");
    },
    permission: () => typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    requestPermission: async () => typeof Notification === "undefined" ? "unsupported" : Notification.requestPermission(),
    ring() {
      if (!audio || audio.state !== "running") throw new Error("Audio is suspended");
      const context = audio;
      const volume = context.createGain();
      const pulse = context.createOscillator();
      const modulation = context.createGain();
      const tones = [context.createOscillator(), context.createOscillator()];
      // Audio-clock modulation keeps repeating even when JS timers are throttled.
      volume.gain.value = 0.045;
      modulation.gain.value = 0.045;
      pulse.type = "square"; pulse.frequency.value = 0.7;
      pulse.connect(modulation); modulation.connect(volume.gain);
      tones.forEach((tone, index) => {
        tone.frequency.value = index === 0 ? 440 : 480;
        tone.connect(volume); tone.start();
      });
      volume.connect(context.destination); pulse.start();
      return () => {
        [...tones, pulse].forEach(tone => { tone.stop(); tone.disconnect(); });
        volume.disconnect(); modulation.disconnect();
      };
    },
    notify(id, onClick) {
      const notice = new Notification("Adventure Zone incoming call", {
        body: "Click to open Command Center and answer.",
        tag: "adventure-zone-call-" + id,
        requireInteraction: true,
      });
      notice.onclick = () => { onClick(); notice.close(); };
      return () => { notice.onclick = null; notice.close(); };
    },
    reveal() {
      window.focus();
      document.getElementById("incoming-call-panel")?.scrollIntoView({ block: "nearest" });
    },
  };
}
