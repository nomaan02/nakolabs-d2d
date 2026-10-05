"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { compassHeading, courseHeading, isWeakFix, type GeoFix } from "@/lib/field/geo";

/**
 * UI-7 C1b (owner H3, 2026-10-04). The ONE `watchPosition` and the ONE
 * orientation listener for the field shell, mounted in app/(field)/layout.tsx.
 * Nothing else in the repo calls `navigator.geolocation` (skill geo-position).
 *
 * Foreground only: the watch runs while the page is visible and is cleared
 * when it is hidden. Fixes live in React state only: never in Dexie, storage,
 * the outbox or a network request. UI-7 C3b adds the one deliberate channel
 * (lib/field/position-share.ts). Denied or unavailable leaves every screen
 * working exactly as before.
 */

export type GeoStatus = "idle" | "active" | "denied" | "unavailable";
export type CompassState = "unknown" | "granted" | "denied" | "not-needed";

export type GeoState = {
  status: GeoStatus;
  fix: GeoFix | null;
  /** Compass when available, else GPS course while walking, else null. */
  heading: number | null;
  /** True when the latest fix is worse than 30 m. */
  weak: boolean;
  compass: CompassState;
  /** Call from a tap. iOS needs it for the compass; elsewhere it does nothing. */
  requestCompass: () => void;
};

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const HEADING_MIN_CHANGE_DEG = 3;
const HEADING_MIN_INTERVAL_MS = 200;

const GeoContext = createContext<GeoState | null>(null);

export function useGeo(): GeoState {
  const value = useContext(GeoContext);
  if (!value) throw new Error("useGeo must be used inside GeoProvider");
  return value;
}

function orientationCtor(): OrientationCtor | null {
  if (typeof window === "undefined" || typeof window.DeviceOrientationEvent === "undefined") return null;
  return window.DeviceOrientationEvent as OrientationCtor;
}

function screenAngle(): number {
  if (typeof screen === "undefined" || !screen.orientation) return 0;
  return screen.orientation.angle || 0;
}

function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function GeoProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [compass, setCompass] = useState<CompassState>("unknown");
  const [compassDeg, setCompassDeg] = useState<number | null>(null);
  const lastHeading = useRef<{ deg: number; at: number } | null>(null);

  // Position: one watch, foreground only, high accuracy.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    let watchId: number | null = null;
    const stop = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };
    const start = () => {
      if (watchId !== null || document.visibilityState !== "visible") return;
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          setStatus("active");
          setFix({
            lng: position.coords.longitude,
            lat: position.coords.latitude,
            accuracyM: position.coords.accuracy,
            courseDeg: position.coords.heading ?? null,
            speedMps: position.coords.speed ?? null,
            at: position.timestamp,
          });
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setStatus("denied");
            setFix(null);
            stop();
            return;
          }
          setStatus((current) => (current === "active" ? current : "unavailable"));
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  // Android and desktop need no compass permission. iOS waits for a tap.
  useEffect(() => {
    const ctor = orientationCtor();
    if (!ctor) {
      setCompass("denied");
      return;
    }
    if (typeof ctor.requestPermission !== "function") setCompass("not-needed");
  }, []);

  useEffect(() => {
    if (compass !== "granted" && compass !== "not-needed") return;
    const onReading = (event: Event) => {
      if (!(event instanceof DeviceOrientationEvent)) return;
      if (document.visibilityState !== "visible") return;
      const ios: unknown = Reflect.get(event, "webkitCompassHeading");
      const deg = compassHeading(
        {
          webkitCompassHeading: typeof ios === "number" ? ios : null,
          alpha: event.alpha,
          absolute: event.absolute,
        },
        screenAngle(),
      );
      if (deg === null) return;
      const now = Date.now();
      const last = lastHeading.current;
      if (last && (now - last.at < HEADING_MIN_INTERVAL_MS || angleGap(last.deg, deg) < HEADING_MIN_CHANGE_DEG)) {
        return;
      }
      lastHeading.current = { deg, at: now };
      setCompassDeg(deg);
    };
    const name = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(name, onReading);
    return () => window.removeEventListener(name, onReading);
  }, [compass]);

  const requestCompass = useCallback(() => {
    const ctor = orientationCtor();
    if (!ctor || typeof ctor.requestPermission !== "function") return;
    ctor
      .requestPermission()
      .then((answer) => setCompass(answer === "granted" ? "granted" : "denied"))
      .catch(() => setCompass("denied"));
  }, []);

  const heading = compassDeg ?? (fix ? courseHeading(fix) : null);
  const weak = fix ? isWeakFix(fix) : false;

  const value = useMemo<GeoState>(
    () => ({ status, fix, heading, weak, compass, requestCompass }),
    [status, fix, heading, weak, compass, requestCompass],
  );

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}
