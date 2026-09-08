export type IncomingNotificationAdapter = {
  permission(): NotificationPermission | "unsupported";
  requestPermission(): Promise<NotificationPermission | "unsupported">;
  notify(onClick: () => void): void;
};

export const incomingNotifications: IncomingNotificationAdapter = {
  permission: () => typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  requestPermission: async () => typeof Notification === "undefined" ? "unsupported" : Notification.requestPermission(),
  notify: (onClick) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const notification = new Notification("Incoming Adventure Zone call", { body: "Incoming Adventure Zone call" });
    notification.onclick = () => { window.focus(); onClick(); notification.close(); };
  },
};