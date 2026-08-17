// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureOptionalEventLocation } from "./event-location";

const originalGeolocation = navigator.geolocation;

afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: originalGeolocation });
});

describe("captureOptionalEventLocation", () => {
  it("returns captured coordinates when permission succeeds", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => success({ coords: { latitude: 46.9, longitude: -102.8 } } as GeolocationPosition)),
      },
    });
    await expect(captureOptionalEventLocation()).resolves.toEqual({ latitude: 46.9, longitude: -102.8, locationStatus: "captured" });
  });

  it("does not reject when location permission is denied", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback) => error({ code: 1 } as GeolocationPositionError)),
      },
    });
    await expect(captureOptionalEventLocation()).resolves.toEqual({ latitude: null, longitude: null, locationStatus: "denied" });
  });

  it("works without geolocation support", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    await expect(captureOptionalEventLocation()).resolves.toEqual({ latitude: null, longitude: null, locationStatus: "unavailable" });
  });
});
