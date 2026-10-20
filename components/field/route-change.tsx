"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFieldData } from "@/components/field/field-data-provider";
import { useGeo } from "@/components/field/geo-provider";
import { ChevronDownIcon, RouteIcon } from "@/components/field/icons";
import { Sheet } from "@/components/field/sheet";
import { Button } from "@/components/field/ui/button";
import { freezeAssignmentRoute } from "@/lib/geo/walk/freeze";
import {
  asVariantKey,
  distanceText,
  fetchVisitRouteOptions,
  kmText,
  metresBetween,
  routeChangeable,
  routeChangeMessage,
  routeName,
  sortRoutes,
  type RouteOption,
  type VisitRouteOptions,
} from "@/lib/geo/walk/route-options";
import { createClient } from "@/lib/supabase/client";

/** While the route can still change, look for a teammate's change this often. */
const POLL_MS = 30_000;
/** Rows shown before "N more alternatives". */
const SHOWN = 3;

export type VisitRoute = {
  options: VisitRouteOptions | null;
  /** Online, open, nobody has knocked (here, on the server or on a teammate's phone), and more than one route fits. */
  canChange: boolean;
  online: boolean;
  busy: boolean;
  error: string | null;
  /** "Ada changed the route to Route B". Shown once, until dismissed. */
  notice: string | null;
  dismissNotice: () => void;
  choose: (key: string) => Promise<boolean>;
  clearError: () => void;
};

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function noticeFor(options: VisitRouteOptions): string {
  const to = options.currentKey ? routeName(options.currentKey) : "another route";
  return options.choice && options.chosenBy ? `${options.chosenBy} changed the route to ${to}` : `The route changed to ${to}`;
}

/**
 * RT-START P1 (owner 2026-10-19; Figma F1-F5, section 240:13771). The visit's
 * saved routes and the one online call that changes which one it walks
 * (`assignment_route_freeze` with a key; never queued, AGENTS.md).
 *
 * Whether this phone walks the visit's current door order is one number:
 * the server's `order_check` against `loadedOrder` (both orderCheckOf). A
 * difference (a teammate or the admin changed the route, or the phone opened
 * on an old copy) reloads the visit and says who changed it. Checked when the
 * app comes back to the front, when the signal returns, and every 30 s until
 * the server has a knock for the visit; after that the route can't change.
 * A reload that fails is tried again on the next check.
 */
export function useVisitRoute(): VisitRoute {
  const { phase, outcomes, team, canvasserId, reloadAssignment, loadedOrder } = useFieldData();
  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;
  const knocked = outcomes.size + team.knockedUprns.size;
  const online = useOnline();
  const [options, setOptions] = useState<VisitRouteOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  /** Bumped by every change from this phone, so an older read can't land after it. */
  const generation = useRef(0);
  /** The server order this phone last reloaded for, so one difference reloads once. */
  const reloadedFor = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!assignmentId || busyRef.current) return;
    const asked = generation.current;
    const result = await fetchVisitRouteOptions(createClient(), assignmentId);
    if (!result.ok || result.options.assignmentId !== assignmentId) return;
    if (asked !== generation.current || busyRef.current) return;
    setOptions(result.options);
  }, [assignmentId]);

  useEffect(() => {
    reloadedFor.current = null;
    setOptions(null);
    setNotice(null);
  }, [assignmentId]);

  // Follow a change made somewhere else.
  useEffect(() => {
    if (busy || !options || options.orderCheck === null || loadedOrder === null) return;
    if (options.orderCheck === loadedOrder) {
      reloadedFor.current = null;
      return;
    }
    if (reloadedFor.current === options.orderCheck) return;
    reloadedFor.current = options.orderCheck;
    void reloadAssignment().then((ok) => {
      if (!ok) {
        reloadedFor.current = null;
        return;
      }
      setNotice(noticeFor(options));
    });
  }, [busy, options, loadedOrder, reloadAssignment]);

  // Until the server has a knock, the route can still change: keep checking.
  // A difference still to follow keeps it checking even after the first knock.
  const watching =
    assignmentId !== null &&
    (options === null || options.knocks === 0 || (options.orderCheck !== null && options.orderCheck !== loadedOrder));
  useEffect(() => {
    if (!watching || !online) return;
    void refresh();
    const onShow = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(id);
    };
  }, [watching, online, refresh]);

  const choose = useCallback(
    async (key: string) => {
      if (!assignmentId || busyRef.current) return false;
      if (!online) {
        setError("Needs signal to change the route. Your current route still works.");
        return false;
      }
      const variant = asVariantKey(key);
      if (!variant) return false;
      busyRef.current = true;
      generation.current += 1;
      setBusy(true);
      setError(null);
      try {
        const result = await freezeAssignmentRoute(createClient(), assignmentId, variant);
        if (result.ok) await reloadAssignment();
        else setError(routeChangeMessage(result.code, result.message));
        // Read the visit again either way: a refusal may mean a teammate knocked or changed it first.
        const after = await fetchVisitRouteOptions(createClient(), assignmentId);
        if (after.ok) setOptions(after.options);
        return result.ok;
      } catch {
        setError(routeChangeMessage("unavailable", ""));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [assignmentId, online, reloadAssignment],
  );

  const usable = options ? options.routes.filter((route) => route.usable).length : 0;
  const canChange =
    options !== null && canvasserId !== null && routeChangeable(options, knocked) && usable > 1;

  return {
    options,
    canChange,
    online,
    busy,
    error,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    choose,
    clearError: useCallback(() => setError(null), []),
  };
}

/** F1: under the header, only while the route can still change. */
export function RouteStrip({ route, onOpen }: { route: VisitRoute; onOpen: () => void }) {
  const current = route.options?.routes.find((entry) => entry.key === route.options?.currentKey) ?? null;
  if (!route.canChange || !current) return null;
  return (
    <div className="flex h-11 w-full items-center gap-2 border-t border-line bg-prop-soft pr-1 pl-4" data-testid="route-strip">
      <RouteIcon className="size-5 shrink-0 text-prop" />
      <p className="min-w-0 flex-1 truncate text-field-button-label text-ink">
        {routeName(current.key)}
        {current.startStreet ? ` · starts on ${current.startStreet}` : ""}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="flex h-11 shrink-0 items-center px-3 text-field-button-label text-prop underline-offset-2 focus-visible:outline-2 focus-visible:outline-prop"
        aria-label="Change route"
        data-testid="route-strip-change"
      >
        Change
      </button>
    </div>
  );
}

/** F2 / F3: pick another saved route, nearest start first. */
export function RouteChangeSheet({
  route,
  teamLine,
  onDone,
}: {
  route: VisitRoute;
  /** "Henleaze · visit 1 · you and Ada". */
  teamLine: string;
  onDone: () => void;
}) {
  const geo = useGeo();
  const from = geo.fix ? { lon: geo.fix.lng, lat: geo.fix.lat } : null;
  const options = route.options;
  const currentKey = options?.currentKey ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const { clearError } = route;
  useEffect(() => clearError, [clearError]);

  // Sorted once per sheet (and when a first fix arrives), so rows don't jump under a thumb.
  const hasFix = from !== null;
  const sorted = useMemo(
    () => (options ? sortRoutes(options.routes, from) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, hasFix],
  );
  const shown = more ? sorted : sorted.slice(0, SHOWN);
  const hidden = sorted.length - shown.length;
  const selected = picked;

  const line = (entry: RouteOption) => {
    const away = from && entry.start ? metresBetween(from, entry.start) : null;
    const title =
      away === null
        ? routeName(entry.key)
        : `${routeName(entry.key)} · ${away < 1000 ? `${distanceText(away)} from you` : `${distanceText(away)} away`}`;
    const parts = [entry.startStreet ? `Starts on ${entry.startStreet}` : null, kmText(entry.totalM)];
    if (entry.key === currentKey) parts.push("current");
    if (!entry.usable) parts.push("doesn't fit today's doors");
    return { title, sub: parts.filter(Boolean).join(" · ") };
  };

  const pick = async () => {
    if (!selected || selected === currentKey) return;
    if (await route.choose(selected)) onDone();
  };

  return (
    <Sheet
      title="Change route"
      onDismiss={onDone}
      footer={
        <div className="flex flex-col gap-2">
          {route.error ? (
            <p role="alert" className="text-field-body text-oxide" data-testid="route-change-error">
              {route.error}
            </p>
          ) : null}
          <Button
            kind="primary"
            className="w-full"
            disabled={!route.online || route.busy || !selected || selected === currentKey}
            onClick={() => void pick()}
          >
            {route.busy ? "Changing…" : selected && selected !== currentKey ? `Use ${routeName(selected)}` : "Pick a route"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-testid="route-change-sheet">
        <p className="text-field-body text-ink-soft">{teamLine}. Locks at the first knock.</p>
        {!route.online ? (
          <p className="rounded-field-sm bg-warn-bg px-3 py-2 text-field-body text-warn-ink" role="status" data-testid="route-change-offline">
            Needs signal to change the route. Your current route still works.
          </p>
        ) : null}
        <p className="text-field-button-label text-ink-muted">
          {from ? "Saved routes · nearest start first" : "Saved routes"}
        </p>
        <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Saved routes">
          {shown.map((entry) => {
            const on = entry.key === selected;
            const { title, sub } = line(entry);
            return (
              <li key={entry.key} role="none">
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  // The current route stays reachable for a screen reader ("current"), but can't be picked.
                  aria-disabled={entry.key === currentKey || undefined}
                  disabled={!route.online || route.busy || !entry.usable}
                  onClick={() => {
                    if (entry.key !== currentKey) setPicked(entry.key);
                  }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-field-lg border px-3.5 py-2.5 text-left disabled:opacity-55 aria-disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                    on ? "border-prop bg-prop-soft" : "border-line bg-surface"
                  }`}
                  data-testid="route-change-row"
                >
                  <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-prop" : "border-ink-faint"}`}>
                    {on ? <span className="size-2.5 rounded-full bg-prop" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-field-body-strong text-ink tabular-nums">{title}</span>
                    <span className="block truncate text-field-button-label text-ink-muted">{sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setMore(true)}
            className="flex min-h-11 items-center justify-between text-field-body text-prop focus-visible:outline-2 focus-visible:outline-prop"
          >
            {hidden === 1 ? "1 more route" : `${hidden} more routes`}
            <ChevronDownIcon className="size-5" />
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
