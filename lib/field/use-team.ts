"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  applyPerson,
  assignmentTopic,
  claimIsLive,
  DOOR_EVENT,
  doorSignal,
  emptyPeople,
  knockedUprns,
  parseDoorSignal,
  reserveDecision,
  shownDoor,
  teammateRows,
  winningHolds,
  type DoorSignal,
  type PersonState,
  type ServerKnock,
  type TeamMember,
  type TeammateRow,
} from "@/lib/field/door-signals";
import type { SequenceDoor } from "@/lib/field/sequence";
import { onUndo } from "@/lib/field/undo";
import { createClient } from "@/lib/supabase/client";

/**
 * One private Realtime channel per assignment, shared by every field tab.
 * Claims are applied in memory and broadcast. They are never inserted.
 */

export type TeamConnection = "off" | "live" | "stale";

export type TeamApi = {
  connection: TeamConnection;
  nextDoor: SequenceDoor | null;
  teammates: TeammateRow[];
  /** Knocked doors plus other people's live claims. Offline, claims are left out. */
  blockedUprns: ReadonlySet<number>;
  /** UPRN whose outcome sheet is open, if the canvasser took one. */
  sheetUprn: number | null;
  claimDoor: (door: SequenceDoor) => void;
  releaseDoor: (uprn: number) => void;
  markKnocked: (door: SequenceDoor, clientEventId: string) => void;
};

export function useTeam(input: {
  assignmentId: string | null;
  canvasserId: string | null;
  sequence: SequenceDoor[];
  localKnocked: ReadonlySet<number>;
}): TeamApi {
  const { assignmentId, canvasserId, sequence, localKnocked } = input;
  const [people, setPeople] = useState<Map<string, PersonState>>(emptyPeople);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [serverKnocks, setServerKnocks] = useState<ServerKnock[]>([]);
  const [serverUprns, setServerUprns] = useState<Set<number>>(() => new Set());
  const [connection, setConnection] = useState<TeamConnection>("off");
  const [now, setNow] = useState(() => Date.now());
  const [reserveGen, setReserveGen] = useState(0);
  const [sheetUprn, setSheetUprn] = useState<number | null>(null);

  const peopleRef = useRef(people);
  peopleRef.current = people;
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const wantReserve = useRef(true);
  const sheetRef = useRef<number | null>(null);
  const pendingClaim = useRef<number | null>(null);
  const knocksByEvent = useRef(new Map<string, { uprn: number; sequence_position: number }>());
  const heardFrom = useRef(new Set<string>());
  const lastAnnounce = useRef(0);

  const bump = useCallback(() => setReserveGen((n) => n + 1), []);

  const publish = useCallback((signal: DoorSignal) => {
    setPeople((current) => applyPerson(current, signal));
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: signal });
  }, []);

  const claimDoor = useCallback(
    (door: SequenceDoor) => {
      if (!canvasserId) return;
      sheetRef.current = door.uprn;
      setSheetUprn(door.uprn);
      wantReserve.current = true;
      pendingClaim.current = door.uprn;
      publish(doorSignal("claim", canvasserId, door.uprn, door.position));
      bump();
    },
    [bump, canvasserId, publish],
  );

  const releaseDoor = useCallback(
    (uprn: number) => {
      if (!canvasserId || sheetRef.current !== uprn) return;
      sheetRef.current = null;
      setSheetUprn(null);
      wantReserve.current = false;
      pendingClaim.current = null;
      const person = peopleRef.current.get(canvasserId);
      const position =
        person?.latest?.uprn === uprn
          ? person.latest.sequence_position
          : (sequenceRef.current.find((door) => door.uprn === uprn)?.position ?? 0);
      publish(doorSignal("release", canvasserId, uprn, position));
      bump();
    },
    [bump, canvasserId, publish],
  );

  const markKnocked = useCallback(
    (door: SequenceDoor, clientEventId: string) => {
      if (!canvasserId) return;
      knocksByEvent.current.set(clientEventId, {
        uprn: door.uprn,
        sequence_position: door.position,
      });
      if (sheetRef.current === door.uprn) {
        sheetRef.current = null;
        setSheetUprn(null);
      }
      wantReserve.current = true;
      pendingClaim.current = null;
      publish(doorSignal("knocked", canvasserId, door.uprn, door.position));
      bump();
    },
    [bump, canvasserId, publish],
  );

  useEffect(() => {
    return onUndo((clientEventId) => {
      if (!canvasserId) return;
      const door = knocksByEvent.current.get(clientEventId);
      knocksByEvent.current.delete(clientEventId);
      if (!door) return;
      publish(doorSignal("release", canvasserId, door.uprn, door.sequence_position));
    });
  }, [canvasserId, publish]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  useEffect(() => {
    if (!assignmentId || !canvasserId) {
      setConnection("off");
      return;
    }

    wantReserve.current = true;
    pendingClaim.current = null;
    heardFrom.current = new Set();
    setPeople(emptyPeople());
    setConnection("off");

    const supabase = createClient();
    const topic = assignmentTopic(assignmentId);
    const channel = supabase.channel(topic, {
      config: { private: true, broadcast: { self: false } },
    });
    channelRef.current = channel;
    let cancelled = false;

    const announce = () => {
      if (Date.now() - lastAnnounce.current < 2000) return;
      const latest = peopleRef.current.get(canvasserId)?.latest;
      if (!latest || !claimIsLive(latest, Date.now())) return;
      const holds = winningHolds(peopleRef.current, Date.now());
      if (!holds.some((hold) => hold.canvasser_id === canvasserId && hold.uprn === latest.uprn)) {
        return;
      }
      lastAnnounce.current = Date.now();
      void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: latest });
    };

    channel.on("broadcast", { event: DOOR_EVENT }, (message) => {
      if (cancelled) return;
      const signal = parseDoorSignal(message.payload);
      if (!signal || signal.canvasser_id === canvasserId) return;
      setPeople((current) => applyPerson(current, signal));
      if (!heardFrom.current.has(signal.canvasser_id)) {
        heardFrom.current.add(signal.canvasser_id);
        announce();
      }
      if (signal.type === "knocked") {
        setServerUprns((current) => {
          if (current.has(signal.uprn)) return current;
          const next = new Set(current);
          next.add(signal.uprn);
          return next;
        });
      }
      bump();
    });

    channel.subscribe((status) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") {
        setConnection("live");
        const latest = peopleRef.current.get(canvasserId)?.latest;
        if (latest && claimIsLive(latest, Date.now())) {
          void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: latest });
        }
        bump();
        return;
      }
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnection("stale");
      }
    });

    const onOffline = () => setConnection("stale");
    window.addEventListener("offline", onOffline);

    const heartbeat = window.setInterval(announce, 8000);

    return () => {
      cancelled = true;
      window.removeEventListener("offline", onOffline);
      window.clearInterval(heartbeat);
      const latest = peopleRef.current.get(canvasserId)?.latest;
      if (latest?.type === "claim" && claimIsLive(latest, Date.now())) {
        const release = doorSignal("release", canvasserId, latest.uprn, latest.sequence_position);
        void channel.send({ type: "broadcast", event: DOOR_EVENT, payload: release });
      }
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [assignmentId, bump, canvasserId]);

  const knocked = useMemo(
    () => knockedUprns(people, serverUprns, localKnocked),
    [people, serverUprns, localKnocked],
  );

  const live = connection === "live";

  useEffect(() => {
    if (!canvasserId || !live) return;
    const latest = people.get(canvasserId)?.latest ?? null;
    const holds = winningHolds(people, now).filter((hold) => !knocked.has(hold.uprn));
    const mine = holds.some((hold) => hold.canvasser_id === canvasserId);
    if (!mine && latest?.type === "claim" && claimIsLive(latest, now)) {
      wantReserve.current = true;
    }

    const decision = reserveDecision({
      wantReserve: wantReserve.current,
      connectionLive: true,
      sequence,
      knocked,
      people,
      selfId: canvasserId,
      now,
    });

    if (decision.action === "hold") {
      wantReserve.current = false;
      pendingClaim.current = null;
      return;
    }
    if (decision.action !== "claim") return;
    if (pendingClaim.current === decision.uprn) return;
    pendingClaim.current = decision.uprn;
    publish(doorSignal("claim", canvasserId, decision.uprn, decision.sequence_position));
  }, [canvasserId, knocked, live, now, people, publish, reserveGen, sequence]);

  const nextDoor = useMemo(
    () => shownDoor(sequence, knocked, people, canvasserId ?? "", now, live),
    [sequence, knocked, people, canvasserId, now, live],
  );

  const teammates = useMemo(() => {
    if (!canvasserId) return [];
    return teammateRows({
      selfId: canvasserId,
      members,
      people,
      serverKnocks,
      now,
      connectionLive: live,
    });
  }, [canvasserId, members, people, serverKnocks, now, live]);

  const blockedUprns = useMemo(() => {
    const blocked = new Set(knocked);
    if (!live || !canvasserId) return blocked;
    for (const hold of winningHolds(people, now)) {
      if (hold.canvasser_id !== canvasserId) blocked.add(hold.uprn);
    }
    return blocked;
  }, [knocked, live, canvasserId, people, now]);

  return useMemo(
    () => ({
      connection,
      nextDoor,
      teammates,
      blockedUprns,
      sheetUprn,
      claimDoor,
      releaseDoor,
      markKnocked,
    }),
    [connection, nextDoor, teammates, blockedUprns, sheetUprn, claimDoor, releaseDoor, markKnocked],
  );
}
