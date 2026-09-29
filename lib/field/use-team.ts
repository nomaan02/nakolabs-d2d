"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  applyPerson,
  assignmentTopic,
  DOOR_EVENT,
  doorSignal,
  emptyPeople,
  HEARTBEAT_INTERVAL_MS,
  hereSignal,
  knockedUprns,
  parseDoorSignal,
  teammateKnocks,
  teammateRows,
  type DoorSignal,
  type PersonState,
  type ServerKnock,
  type TeamKnock,
  type TeamMember,
  type TeammateRow,
} from "@/lib/field/door-signals";
import type { SequenceDoor } from "@/lib/field/sequence";
import { onUndo } from "@/lib/field/undo";
import { createClient } from "@/lib/supabase/client";

/**
 * One private Realtime channel per assignment, shared by every field tab.
 *
 * Amended 2026-09-28 (owner, UI item 1). Claims, Take and reserve are
 * removed. A log broadcasts `knocked`; an undo broadcasts `unknocked`; every
 * connected session sends a `here` heartbeat on subscribe and every 15 s, so
 * a dropped session shows as stale (45 s of silence) rather than as a false
 * "still with us". There is no "next door" or "blocked door" concept here
 * any more — `lib/field/cursor.ts` decides where to go next, on this
 * canvasser's own action only.
 */

export type TeamConnection = "off" | "live" | "stale";

export type TeamApi = {
  connection: TeamConnection;
  /** One row per other active member (a trio is two rows). Empty when solo. */
  teammates: TeammateRow[];
  /** Server-known knocks, this device's own local knocks, and every live broadcast. */
  knockedUprns: ReadonlySet<number>;
  /** Latest-wins: which teammate last knocked each door, and when. Never this canvasser. */
  knockedBy: ReadonlyMap<number, TeamKnock>;
  markKnocked: (door: SequenceDoor, clientEventId: string) => void;
};

export function useTeam(input: {
  assignmentId: string | null;
  canvasserId: string | null;
  localKnocked: ReadonlySet<number>;
}): TeamApi {
  const { assignmentId, canvasserId, localKnocked } = input;
  const [people, setPeople] = useState<Map<string, PersonState>>(emptyPeople);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [serverKnocks, setServerKnocks] = useState<ServerKnock[]>([]);
  const [serverUprns, setServerUprns] = useState<Set<number>>(() => new Set());
  const [connection, setConnection] = useState<TeamConnection>("off");
  const [now, setNow] = useState(() => Date.now());

  const channelRef = useRef<RealtimeChannel | null>(null);
  /** clientEventId -> the door it knocked, so an undo can broadcast exactly that unknocked. */
  const knocksByEvent = useRef(new Map<string, { uprn: number; sequence_position: number }>());

  const publish = useCallback((signal: DoorSignal) => {
    setPeople((current) => applyPerson(current, signal));
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: signal });
  }, []);

  const markKnocked = useCallback(
    (door: SequenceDoor, clientEventId: string) => {
      if (!canvasserId) return;
      knocksByEvent.current.set(clientEventId, {
        uprn: door.uprn,
        sequence_position: door.position,
      });
      publish(doorSignal("knocked", canvasserId, door.uprn, door.position));
    },
    [canvasserId, publish],
  );

  // P2: undo broadcasts `unknocked`, replacing the old `release`.
  useEffect(() => {
    return onUndo((clientEventId) => {
      if (!canvasserId) return;
      const door = knocksByEvent.current.get(clientEventId);
      knocksByEvent.current.delete(clientEventId);
      if (!door) return;
      publish(doorSignal("unknocked", canvasserId, door.uprn, door.sequence_position));
    });
  }, [canvasserId, publish]);

  // Drives `stale` for every teammate row, every second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Members and server knocks: once on mount, and again whenever the device
  // comes back online (a stale membership list would otherwise hide a
  // teammate who joined while this device had no signal).
  useEffect(() => {
    if (!assignmentId) {
      setMembers([]);
      setServerKnocks([]);
      setServerUprns(new Set());
      return;
    }
    let cancelled = false;
    const supabase = createClient();

    const load = async () => {
      const { data: memberRows, error } = await supabase
        .from("assignment_members")
        .select("canvasser_id, route_position_m, route_position_at, left_at")
        .eq("assignment_id", assignmentId)
        .is("left_at", null);
      if (cancelled || error || !memberRows) return;

      const ids = memberRows.map((row) => row.canvasser_id);
      const names = new Map<string, string | null>();
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        for (const profile of profiles ?? []) names.set(profile.id, profile.full_name);
      }
      if (cancelled) return;
      setMembers(
        memberRows.map((row) => ({
          canvasser_id: row.canvasser_id,
          full_name: names.get(row.canvasser_id) ?? null,
          route_position_m: row.route_position_m,
          route_position_at: row.route_position_at,
        })),
      );

      const { data: knocks, error: knockError } = await supabase
        .from("knock_events")
        .select("canvasser_id, uprn, sequence_position, occurred_at")
        .eq("assignment_id", assignmentId);
      if (cancelled || knockError || !knocks) return;
      setServerKnocks(knocks);
      setServerUprns(new Set(knocks.map((row) => row.uprn)));
    };

    void load();
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [assignmentId]);

  // The channel itself: subscribe, receive knocked/unknocked/here, heartbeat.
  useEffect(() => {
    if (!assignmentId || !canvasserId) {
      setConnection("off");
      return;
    }

    setPeople(emptyPeople());
    setConnection("off");

    const supabase = createClient();
    const topic = assignmentTopic(assignmentId);
    const channel = supabase.channel(topic, {
      config: { private: true, broadcast: { self: false } },
    });
    channelRef.current = channel;
    let cancelled = false;

    channel.on("broadcast", { event: DOOR_EVENT }, (message) => {
      if (cancelled) return;
      const signal = parseDoorSignal(message.payload);
      if (!signal || signal.canvasser_id === canvasserId) return;
      setPeople((current) => applyPerson(current, signal));
      if (signal.type === "knocked") {
        setServerUprns((current) => {
          if (current.has(signal.uprn)) return current;
          const next = new Set(current);
          next.add(signal.uprn);
          return next;
        });
      }
    });

    channel.subscribe((status) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") {
        setConnection("live");
        void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: hereSignal(canvasserId) });
        return;
      }
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnection("stale");
      }
    });

    const heartbeat = window.setInterval(() => {
      void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: hereSignal(canvasserId) });
    }, HEARTBEAT_INTERVAL_MS);

    const onOffline = () => setConnection("stale");
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      window.removeEventListener("offline", onOffline);
      window.clearInterval(heartbeat);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [assignmentId, canvasserId]);

  const knocked = useMemo(
    () => knockedUprns(people, serverUprns, localKnocked),
    [people, serverUprns, localKnocked],
  );

  const teammates = useMemo(() => {
    if (!canvasserId) return [];
    return teammateRows({
      selfId: canvasserId,
      members,
      people,
      serverKnocks,
      now,
      connectionLive: connection === "live",
    });
  }, [canvasserId, members, people, serverKnocks, now, connection]);

  const knockedBy = useMemo(() => {
    if (!canvasserId) return new Map<number, TeamKnock>();
    return teammateKnocks(people, serverKnocks, canvasserId, members);
  }, [canvasserId, people, serverKnocks, members]);

  return useMemo(
    () => ({ connection, teammates, knockedUprns: knocked, knockedBy, markKnocked }),
    [connection, teammates, knocked, knockedBy, markKnocked],
  );
}
