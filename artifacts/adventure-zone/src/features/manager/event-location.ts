export type EventLocationStatus = "captured" | "unavailable" | "denied" | "error" | "not_requested";
export type EventLocationCapture = { latitude: number | null; longitude: number | null; locationStatus: EventLocationStatus };

export async function captureOptionalEventLocation(): Promise<EventLocationCapture> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { latitude: null, longitude: null, locationStatus: "unavailable" };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, locationStatus: "captured" }),
      (error) => resolve({ latitude: null, longitude: null, locationStatus: error.code === 1 ? "denied" : "error" }),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    );
  });
}
