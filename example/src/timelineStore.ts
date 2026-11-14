import { useSyncExternalStore } from "react";

/** The color of a line: success, a 401, a failure, the refresh, or plain. */
export type Tone = "ok" | "warn" | "error" | "refresh" | "plain";

export interface TimelineEntry {
  id: number;
  /** `performance.now()` when it happened. */
  time: number;
  source: "client" | "server";
  /** A hook name (`onRequest`), `refresh()`, or the server's status. */
  label: string;
  /** The request path, for picking the lines of one request. */
  path: string;
  text: string;
  tone: Tone;
}

/** Everything the client hooks and the fake server report, in order. */
let entries: readonly TimelineEntry[] = [];
const listeners = new Set<() => void>();

export function addEntry(entry: Omit<TimelineEntry, "id" | "time">): void {
  entries = [...entries, { ...entry, id: entries.length, time: performance.now() }];
  for (const listener of listeners) listener();
}

/** The id the next entry gets: a run started now shows the entries from it on. */
export function nextEntryId(): number {
  return entries.length;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimeline(): readonly TimelineEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}
