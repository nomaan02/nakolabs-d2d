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

import { useFieldData } from "@/components/field/field-data-provider";
import { furthestOwnLogIndex, type Reopen } from "@/lib/field/geo-lock";
import {
  buildRouteIndex,
  compassHeading,
  courseHeading,
  doorAlongs,
  isWeakFix,
  routeScalar,
  snapToRoute,
  type GeoFix,
} from "@/lib/field/geo";

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
  /**
   * UI-7 C2. Where the last good fix sits on the route, in server metres
   * (`route_steps.cumulative_m`). `alongM` is null more than 100 m from the
   * route (Stage 16 rule 7). Null before the first good fix, or unrouted.
   * `at` is that fix's timestamp, so a consumer can step once per fix.
   */
  routePlace: RoutePlace | null;
  /** UI-7 C2. Each sequence door's distance along the route, index-aligned with `sequence`. */
  doorAlongsM: number[];
  /**
   * GPS-LOCK GL-2 (owner G2). The latest return to the app: a cold start when
   * the page loads, then one per hidden → visible. Null until the first.
   */
  reopen: Reopen | null;
};

/** `accuracyM` is that fix's accuracy (GL-2: jumps need 20 m or better). */
export type RoutePlace = { alongM: number | null; at: number; accuracyM: number };

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const HEADING_MIN_CHANGE_DEG = 3;
const HEADING_MIN_INTERVAL_MS = 200;

const GeoContext = createContext<GeoState | null>(null);

/**
 * GL-2: when the canvasser last touched the screen or pressed a key, page
 * wide (any tab). A reopen they have already acted on never jumps (G3).
 */
let lastInputAt = 0;

export function lastUserInputAt(): number {
  return lastInputAt;
}

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
  const { routeLine, routeSteps, sequence, cursor, outcomes, canvasserId } = useFieldData();
  const [routePlace, setRoutePlace] = useState<RoutePlace | null>(null);
  const previousAlong = useRef<number | null>(null);
  const cursorIndex = useRef(cursor.index);
  cursorIndex.current = cursor.index;
  // GL-2: the first snap after a page load is seeded from the furthest door
  // this canvasser logged, not the cursor (a reload puts the cursor on door 1).
  const furthest = useMemo(
    () => furthestOwnLogIndex(sequence, outcomes, canvasserId),
    [sequence, outcomes, canvasserId],
  );
  const furthestLog = useRef(furthest);
  furthestLog.current = furthest;
  const seededWithLog = useRef(false);
  const [reopen, setReopen] = useState<Reopen | null>(null);
  const reopenCount = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  const placeAtHide = useRef<number | null>(null);

  useEffect(() => {
    const mark = () => {
      lastInputAt = Date.now();
    };
    window.addEventListener("pointerdown", mark, true);
    window.addEventListener("keydown", mark, true);
    return () => {
      window.removeEventListener("pointerdown", mark, true);
      window.removeEventListener("keydown", mark, true);
    };
  }, []);

  const routeIndex = useMemo(() => {
    const last = routeSteps[routeSteps.length - 1];
    return buildRouteIndex(routeLine?.coordinates, last ? last.cumulative_m : null);
  }, [routeLine, routeSteps]);

  // GL-2: the one re-seed below is allowed again for a new route or canvasser.
  useEffect(() => {
    seededWithLog.current = false;
  }, [routeIndex, canvasserId]);

  // GL-2: if the first snap happened before the outbox was read, snap again
  // from the furthest log once it is known, so the right pass is kept.
  useEffect(() => {
    if (furthest >= 0 && !seededWithLog.current) {
      seededWithLog.current = true;
      previousAlong.current = null;
    }
  }, [furthest]);

  const doorAlongsM = useMemo(
    () =>
      routeIndex
        ? doorAlongs(
            routeIndex,
            sequence.map((door) => ({ lngLat: door.lngLat, position: door.position })),
            routeSteps,
          )
        : [],
    [routeIndex, sequence, routeSteps],
  );

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
    // GL-2: note when the app is hidden and where along the route the
    // canvasser was, so the Logger can decide whether to jump on return.
    // A page that loads hidden counts as a cold start when first shown.
    let coldPending = false;
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (hiddenAt.current !== null) {
          const now = Date.now();
          reopenCount.current += 1;
          setReopen({
            id: reopenCount.current,
            at: now,
            hiddenMs: coldPending ? null : now - hiddenAt.current,
            placeBeforeM: coldPending ? null : placeAtHide.current,
          });
          hiddenAt.current = null;
          coldPending = false;
        }
        start();
      } else {
        if (hiddenAt.current === null) {
          hiddenAt.current = Date.now();
          placeAtHide.current = previousAlong.current;
        }
        stop();
      }
    };
    if (document.visibilityState === "visible") {
      reopenCount.current += 1;
      setReopen({ id: reopenCount.current, at: Date.now(), hiddenMs: null, placeBeforeM: null });
    } else {
      hiddenAt.current = Date.now();
      coldPending = true;
    }
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

  // UI-7 C2. Snap each good fix onto the route, on the device. Weak fixes
  // leave the last place alone. The coordinate is never kept.
  useEffect(() => {
    if (!routeIndex || !fix) {
      previousAlong.current = null;
      setRoutePlace(null);
      return;
    }
    if (isWeakFix(fix)) return;
    const seed =
      previousAlong.current ?? doorAlongsM[furthestLog.current] ?? doorAlongsM[cursorIndex.current] ?? null;
    const alongM = routeScalar(snapToRoute(routeIndex, [fix.lng, fix.lat], seed));
    if (alongM !== null) {
      previousAlong.current = alongM;
      if (furthestLog.current >= 0) seededWithLog.current = true;
    }
    setRoutePlace({ alongM, at: fix.at, accuracyM: fix.accuracyM });
  }, [routeIndex, doorAlongsM, fix]);

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
    () => ({ status, fix, heading, weak, compass, requestCompass, routePlace, doorAlongsM, reopen }),
    [status, fix, heading, weak, compass, requestCompass, routePlace, doorAlongsM, reopen],
  );

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}
