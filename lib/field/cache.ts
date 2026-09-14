import { FIELD_DB_NAME, fieldDb, type CachedAssignment } from "@/lib/field/db";
import { londonDate } from "@/lib/field/london-date";
import type { TodaysAssignment } from "@/lib/geo/todays-assignment";

const STORE = "assignments";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function readTodayNative(
  today: string,
  canvasserId: string,
): Promise<CachedAssignment | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FIELD_DB_NAME);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    request.onsuccess = () => {
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains(STORE)) {
          db.close();
          resolve(undefined);
          return;
        }
        const tx = db.transaction(STORE, "readonly");
        const getAll = tx.objectStore(STORE).getAll();
        getAll.onsuccess = () => {
          const rows = getAll.result as CachedAssignment[];
          resolve(
            rows.find((row) => row.work_date === today && row.canvasser_id === canvasserId),
          );
          db.close();
        };
        getAll.onerror = () => {
          db.close();
          reject(getAll.error ?? new Error("indexedDB read failed"));
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

/** Writes the full RPC response, keyed to the assignment and the canvasser. */
export async function cacheAssignment(
  payload: TodaysAssignment,
  canvasserId: string,
): Promise<void> {
  await fieldDb().assignments.put({
    assignment_id: payload.assignment_id,
    canvasser_id: canvasserId,
    work_date: payload.work_date,
    cached_at: new Date().toISOString(),
    payload,
  });
}

export async function getCachedToday(
  canvasserId: string,
  at: Date = new Date(),
): Promise<CachedAssignment | undefined> {
  const today = londonDate(at);
  try {
    const rows = await withTimeout(fieldDb().assignments.toArray(), 1500, "dexie");
    return rows.find((row) => row.work_date === today && row.canvasser_id === canvasserId);
  } catch {
    return withTimeout(readTodayNative(today, canvasserId), 1500, "indexedDB");
  }
}

/** Honest empty from the network: drop this canvasser's cached row for today. */
export async function clearCachedToday(
  canvasserId: string,
  at: Date = new Date(),
): Promise<void> {
  const today = londonDate(at);
  const rows = await fieldDb().assignments.toArray();
  const stale = rows.filter((row) => row.work_date === today && row.canvasser_id === canvasserId);
  await Promise.all(stale.map((row) => fieldDb().assignments.delete(row.assignment_id)));
}
