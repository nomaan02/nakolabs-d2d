"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/supabase/types";
import {
  DELETE_PREVIEW_SENTENCE,
  closePreviewSentence,
  formatThreshold,
  mapReallocationRpcError,
  parseVisitThreshold,
  shareCounts,
  sharePercent,
  workedDoors,
  type ReallocationFailureCode,
} from "@/lib/geo/reallocation";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Failure = { ok: false; code: ReallocationFailureCode; message: string; detail?: string };

function sessionEnded(message: string): Failure {
  return { ok: false, code: "not_admin", message };
}

function revalidateAllocation() {
  revalidatePath("/admin/allocate");
  revalidatePath("/admin/settings");
}

async function adminClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function asRecord(data: Json): Record<string, Json | undefined> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data;
}

function asNumber(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type RemovalPreview =
  | {
      kind: "delete";
      total: number;
      sentence: string;
    }
  | {
      kind: "close";
      worked: number;
      total: number;
      percent: number;
      thresholdPct: number;
      thresholdSource: "setting" | "default";
      countsForRotation: boolean;
      sentence: string;
      thresholdSentence: string;
    };

export type RemovalPreviewResult = { ok: true; preview: RemovalPreview } | Failure;

/**
 * What assignment_remove will do, read at the moment the admin asks.
 * Knock count decides delete versus early end. The share is distinct
 * snapshot doors, and the threshold is the live app_settings value —
 * the same two rules the RPC applies.
 */
export async function previewAssignmentRemoval(assignmentId: string): Promise<RemovalPreviewResult> {
  const id = assignmentId.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment does not exist." };
  }

  const { supabase, user } = await adminClient();
  if (!user) {
    return sessionEnded("Your session has ended. Sign in again to remove this allocation.");
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, closed_at, uprn_snapshot")
    .eq("id", id)
    .maybeSingle();

  if (assignmentError) {
    return mapReallocationRpcError(assignmentError);
  }
  if (!assignment) {
    return { ok: false, code: "missing_assignment", message: "That assignment does not exist." };
  }
  if (assignment.closed_at) {
    return { ok: false, code: "already_closed", message: "That assignment is already closed." };
  }

  const { count, error: countError } = await supabase
    .from("knock_events")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);

  if (countError) return mapReallocationRpcError(countError);

  const total = assignment.uprn_snapshot.length;
  const knocks = count ?? 0;
  if (knocks === 0) {
    return {
      ok: true,
      preview: { kind: "delete", total, sentence: DELETE_PREVIEW_SENTENCE },
    };
  }

  const knocked: number[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("knock_events")
      .select("uprn")
      .eq("assignment_id", id)
      .range(from, from + page - 1);
    if (error) return mapReallocationRpcError(error);
    const rows = data ?? [];
    for (const row of rows) knocked.push(row.uprn);
    if (rows.length < page) break;
  }

  const { data: setting, error: settingError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "rotation")
    .maybeSingle();
  if (settingError) return mapReallocationRpcError(settingError);

  const threshold = parseVisitThreshold(setting?.value);
  const worked = workedDoors(assignment.uprn_snapshot, knocked);
  const percent = sharePercent(worked, total);
  const counts = shareCounts(percent, threshold.pct);
  const thresholdSentence =
    threshold.source === "setting"
      ? `Threshold is ${formatThreshold(threshold.pct)}%.`
      : `Threshold is ${formatThreshold(threshold.pct)}%. The stored setting is not a percentage from 0 to 100, so 50% is used.`;

  return {
    ok: true,
    preview: {
      kind: "close",
      worked,
      total,
      percent,
      thresholdPct: threshold.pct,
      thresholdSource: threshold.source,
      countsForRotation: counts,
      sentence: closePreviewSentence({ worked, total, percent, counts }),
      thresholdSentence,
    },
  };
}

export type AssignmentRemoval = {
  action: "deleted" | "closed";
  worked: number;
  total: number;
  percent: number | null;
  thresholdPct: number | null;
  thresholdSource: "setting" | "default" | null;
  countsForRotation: boolean | null;
  sentence: string;
};

export type RemoveAssignmentResult = { ok: true; removal: AssignmentRemoval } | Failure;

export async function removeAssignmentAction(assignmentId: string): Promise<RemoveAssignmentResult> {
  const id = assignmentId.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment does not exist." };
  }

  const { supabase, user } = await adminClient();
  if (!user) {
    return sessionEnded("Your session has ended. Sign in again to remove this allocation.");
  }

  const { data, error } = await supabase.rpc("assignment_remove", { p_assignment_id: id });
  if (error) return mapReallocationRpcError(error);

  const removal = readRemoval(data);
  if (!removal) {
    return {
      ok: false,
      code: "unavailable",
      message: "That change could not be saved. Try again.",
      detail: "assignment_remove returned an unexpected result",
    };
  }

  revalidateAllocation();
  return { ok: true, removal };
}

function readRemoval(data: Json): AssignmentRemoval | null {
  const row = asRecord(data);
  if (!row) return null;
  const total = asNumber(row.total);
  const worked = asNumber(row.worked);
  if (total === null || worked === null) return null;

  if (row.action === "deleted") {
    return {
      action: "deleted",
      worked,
      total,
      percent: null,
      thresholdPct: null,
      thresholdSource: null,
      countsForRotation: null,
      sentence: "This allocation has been deleted.",
    };
  }

  if (row.action !== "closed") return null;
  const percent = asNumber(row.percent_worked);
  const thresholdPct = asNumber(row.threshold_pct);
  const counts = row.counts_for_rotation;
  const source = row.threshold_source;
  if (percent === null || thresholdPct === null || typeof counts !== "boolean") return null;
  if (source !== "setting" && source !== "default") return null;

  const decision = counts ? "will" : "will not";
  return {
    action: "closed",
    worked,
    total,
    percent,
    thresholdPct,
    thresholdSource: source,
    countsForRotation: counts,
    sentence:
      `Ended this visit. ${worked} of ${total} doors worked (${formatThreshold(percent)}%). ` +
      `This ${decision} count toward rotation. Threshold ${formatThreshold(thresholdPct)}%.`,
  };
}

export type MemberChangeResult =
  | {
      ok: true;
      action: "added" | "readded" | "left";
      activeMembers: number;
      assignmentClosed: boolean;
    }
  | Failure;

export async function addMemberAction(
  assignmentId: string,
  canvasserId: string,
): Promise<MemberChangeResult> {
  const id = assignmentId.trim();
  const canvasser = canvasserId.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment does not exist." };
  }
  if (!UUID.test(canvasser)) {
    return { ok: false, code: "not_canvasser", message: "That canvasser is not an active canvasser." };
  }

  const { supabase, user } = await adminClient();
  if (!user) {
    return sessionEnded("Your session has ended. Sign in again to add a canvasser.");
  }

  const { data, error } = await supabase.rpc("assignment_member_add", {
    p_assignment_id: id,
    p_canvasser_id: canvasser,
  });
  if (error) return mapReallocationRpcError(error);

  const row = asRecord(data);
  const active = row ? asNumber(row.active_members) : null;
  const action = row?.action;
  if (!row || active === null || (action !== "added" && action !== "readded")) {
    return {
      ok: false,
      code: "unavailable",
      message: "That change could not be saved. Try again.",
      detail: "assignment_member_add returned an unexpected result",
    };
  }

  revalidateAllocation();
  return { ok: true, action, activeMembers: active, assignmentClosed: false };
}

export async function removeMemberAction(
  assignmentId: string,
  canvasserId: string,
): Promise<MemberChangeResult> {
  const id = assignmentId.trim();
  const canvasser = canvasserId.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment does not exist." };
  }
  if (!UUID.test(canvasser)) {
    return { ok: false, code: "not_member", message: "That canvasser is not on this assignment." };
  }

  const { supabase, user } = await adminClient();
  if (!user) {
    return sessionEnded("Your session has ended. Sign in again to remove a canvasser.");
  }

  const { data, error } = await supabase.rpc("assignment_member_remove", {
    p_assignment_id: id,
    p_canvasser_id: canvasser,
  });
  if (error) return mapReallocationRpcError(error);

  const row = asRecord(data);
  const active = row ? asNumber(row.remaining_active) : null;
  const closed = row?.assignment_closed;
  if (!row || row.action !== "left" || active === null || typeof closed !== "boolean") {
    return {
      ok: false,
      code: "unavailable",
      message: "That change could not be saved. Try again.",
      detail: "assignment_member_remove returned an unexpected result",
    };
  }

  revalidateAllocation();
  return { ok: true, action: "left", activeMembers: active, assignmentClosed: closed };
}

export type ThresholdSaveResult =
  | { ok: true; savedPct: number; source: "setting" | "default" }
  | { ok: false; message: string };

/**
 * Writes visit_threshold_pct and reads the row back. The returned number is
 * what is stored, so a value the RPC would ignore is not reported as saved.
 */
export async function saveVisitThresholdAction(pct: number): Promise<ThresholdSaveResult> {
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { ok: false, message: "Enter a percentage from 0 to 100." };
  }

  const { supabase, user } = await adminClient();
  if (!user) {
    return { ok: false, message: "Your session has ended. Sign in again to change the threshold." };
  }

  const { data: existing, error: readError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "rotation")
    .maybeSingle();
  if (readError) {
    return { ok: false, message: "The threshold could not be saved. Try again." };
  }

  const base =
    existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
      ? existing.value
      : {};
  const next = { ...base, visit_threshold_pct: pct };

  const write = existing
    ? await supabase
        .from("app_settings")
        .update({ value: next, updated_at: new Date().toISOString(), updated_by: user.id })
        .eq("key", "rotation")
        .select("value")
        .single()
    : await supabase
        .from("app_settings")
        .insert({ key: "rotation", value: next, updated_by: user.id })
        .select("value")
        .single();

  if (write.error || !write.data) {
    return { ok: false, message: "The threshold could not be saved. Try again." };
  }

  const saved = parseVisitThreshold(write.data.value);
  revalidateAllocation();
  return { ok: true, savedPct: saved.pct, source: saved.source };
}
