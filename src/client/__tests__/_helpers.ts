import type { FetchFunction } from "../..";

export interface RecordedCall {
  url: string;
  init: RequestInit;
  headers: Headers;
}

/** A `fetch` that records every call and answers with a fresh response from `respond`. */
export function recordingFetch(
  respond: () => Response = () => new Response(null, { status: 204 }),
): {
  fetch: FetchFunction;
  calls: RecordedCall[];
  last: () => RecordedCall;
} {
  const calls: RecordedCall[] = [];
  const fetch: FetchFunction = (url, init) => {
    calls.push({ url, init, headers: new Headers(init.headers) });
    return Promise.resolve(respond());
  };
  const last = (): RecordedCall => {
    const call = calls.at(-1);
    if (call === undefined) throw new Error("fetch was not called");
    return call;
  };
  return { fetch, calls, last };
}
