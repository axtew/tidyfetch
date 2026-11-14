import { useState, useSyncExternalStore } from "react";
import { HttpError } from "tidyfetch";

import { api, server } from "../api";
import { REFRESH_DELAY } from "../fakeServer";
import { Timeline } from "../Timeline";
import { nextEntryId, type TimelineEntry, useTimeline } from "../timelineStore";

const IDS = [1, 2, 3, 4, 5];

interface Item {
  id: number;
  name: string;
}

interface Run {
  /** The first timeline entry of this run. */
  from: number;
  start: number;
}

interface Outcome {
  ok: boolean;
  text: string;
}

const CODE = `let accessToken = login();

const api = createClient({
  baseUrl: "/api",
  headers: () => ({ Authorization: \`Bearer \${accessToken}\` }),
  // One call for all parallel 401s; each request is then retried once.
  refresh: async () => {
    const { data } = await api.post("/auth/refresh", {
      schema: Tokens,
      skipRefresh: true, // its own 401 must not wait for itself
    });
    accessToken = data.accessToken;
    return true;
  },
  onRequest, onResponse, onError, // they write the timeline below
  fetch: fakeServer.fetch, // no backend: the server is in the page
});

await Promise.all(
  [1, 2, 3, 4, 5].map((id) => api.get<Item>(\`/items/\${id}\`)),
);`;

function describeFailure(error: unknown): string {
  if (!(error instanceof HttpError)) return String(error);
  const cause = error.cause instanceof Error ? `; cause: ${error.cause.message}` : "";
  return `HttpError ${error.status}${cause}`;
}

const count = (entries: readonly TimelineEntry[], source: string, label: string): number =>
  entries.filter((entry) => entry.source === source && entry.label === label).length;

function countersOf(entries: readonly TimelineEntry[]) {
  const items = entries.filter((entry) => entry.path.startsWith("/api/items/"));
  return {
    sent: count(items, "client", "onRequest"),
    unauthorized: count(items, "server", "401"),
    refreshes: count(entries, "client", "refresh()"),
    succeeded: count(items, "client", "onResponse"),
    failed: count(items, "client", "onError"),
  };
}

export function RefreshScreen() {
  const token = useSyncExternalStore(server.subscribe, server.getToken);
  const timeline = useTimeline();
  const [latency, setLatency] = useState(server.settings.latency);
  const [refreshFails, setRefreshFails] = useState(server.settings.refreshFails);
  const [lateResponse, setLateResponse] = useState(server.settings.lateResponse);
  const [run, setRun] = useState<Run | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

  const entries = run === null ? [] : timeline.slice(run.from);
  const counters = countersOf(entries);
  const running = run !== null && outcomes === null;

  async function send(): Promise<void> {
    setOutcomes(null);
    setRun({ from: nextEntryId(), start: performance.now() });
    const settled = await Promise.allSettled(IDS.map((id) => api.get<Item>(`/items/${id}`)));
    setOutcomes(
      settled.map((result) =>
        result.status === "fulfilled"
          ? { ok: true, text: `200 ${JSON.stringify(result.value.data)}` }
          : { ok: false, text: describeFailure(result.reason) },
      ),
    );
  }

  return (
    <section className="card">
      <h2>Five 401s, one refresh</h2>
      <p className="intro">
        Five requests go out in parallel with an expired access token and all get 401. The client
        calls <code>refresh</code> once ({REFRESH_DELAY} ms here), every request waits for that one
        call, then each is sent once more with the new token.
      </p>

      <div className="server-panel">
        <h3>Fake server</h3>
        <div className="token-row">
          <span>
            Access token <code>{token.token}</code>{" "}
            <span className={token.expired ? "badge badge-warn" : "badge badge-ok"}>
              {token.expired ? "expired" : "valid"}
            </span>
          </span>
          <button type="button" disabled={token.expired} onClick={server.expireToken}>
            Expire token
          </button>
        </div>
        <div className="fields">
          <label className="range">
            <span>
              Latency <strong>{latency} ms</strong>
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={50}
              value={latency}
              onChange={(event) => {
                const value = Number(event.target.value);
                setLatency(value);
                server.settings.latency = value;
              }}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={refreshFails}
              onChange={(event) => {
                setRefreshFails(event.target.checked);
                server.settings.refreshFails = event.target.checked;
              }}
            />
            Refresh fails
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={lateResponse}
              onChange={(event) => {
                setLateResponse(event.target.checked);
                server.settings.lateResponse = event.target.checked;
              }}
            />
            One 401 arrives after the refresh
          </label>
        </div>
        <p className="hint">
          {refreshFails
            ? "The refresh endpoint answers 401: all five requests fail with their 401 HttpError, and the refresh's error becomes its cause."
            : lateResponse
              ? "The 401 of /items/5 arrives when the refresh is already over: it went out with the old token, so it is retried at once, without a second refresh."
              : token.expired
                ? "The token is expired: the next requests get 401."
                : "The token is valid: the requests go through without a refresh. Expire it to see one."}
        </p>
      </div>

      <button type="button" className="primary" disabled={running} onClick={() => void send()}>
        {running ? "Sending..." : "Send 5 requests"}
      </button>

      <dl className="counters" aria-label="Counters">
        <div>
          <dt>Sent, retries too</dt>
          <dd data-counter="sent">{counters.sent}</dd>
        </div>
        <div>
          <dt>401 responses</dt>
          <dd data-counter="unauthorized">{counters.unauthorized}</dd>
        </div>
        <div className="counter-refresh">
          <dt>Refresh calls</dt>
          <dd data-counter="refreshes">{counters.refreshes}</dd>
        </div>
        <div>
          <dt>Succeeded</dt>
          <dd data-counter="succeeded">{counters.succeeded}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd data-counter="failed">{counters.failed}</dd>
        </div>
      </dl>

      {run !== null && (
        <>
          <h3>Results</h3>
          <ul className="outcomes">
            {IDS.map((id, index) => {
              const outcome = outcomes?.[index];
              return (
                <li key={id} className={outcome === undefined ? "" : outcome.ok ? "ok" : "failed"}>
                  <code>/items/{id}</code> {outcome === undefined ? "pending" : outcome.text}
                </li>
              );
            })}
          </ul>

          <h3>Timeline</h3>
          <p className="hint">
            <strong>client</strong> lines come from the hooks, <strong>server</strong> lines from
            the fake server. A 401 cured by the refresh never reaches <code>onError</code>.
          </p>
          <Timeline entries={entries} start={run.start} />
        </>
      )}

      <h3>The code</h3>
      <pre>
        <code>{CODE}</code>
      </pre>
    </section>
  );
}
