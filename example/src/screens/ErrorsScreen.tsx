import { useRef, useState } from "react";
import {
  HttpError,
  type HttpResponse,
  NetworkError,
  ParseError,
  SchemaError,
  TimeoutError,
} from "tidyfetch";
import { z } from "zod";

import { api } from "../api";
import { SLOW_DELAY } from "../fakeServer";
import { nextEntryId, useTimeline } from "../timelineStore";

const Order = z.object({
  items: z.array(z.object({ id: z.number(), price: z.number() })),
});

interface Scenario {
  title: string;
  description: string;
  code: string;
  /** The path the request goes to, for picking its hook calls from the timeline. */
  path: string;
  run: (signal: AbortSignal) => Promise<HttpResponse>;
  /** Shows an Abort button while the request is pending. */
  abortable?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    title: "HttpError",
    description: "The server answered with a status outside 200-299. The error body is parsed.",
    path: "/api/server-error",
    code: `try {
  await api.get("/server-error");
} catch (error) {
  if (error instanceof HttpError) {
    error.status; // 500
    error.data; // the parsed error body
  }
}`,
    run: () => api.get("/server-error"),
  },
  {
    title: "TimeoutError",
    description: `The server takes ${SLOW_DELAY / 1000} s, this request allows 1 s. The default timeout is 30 s.`,
    path: "/api/slow",
    code: `await api.get("/slow", { timeout: 1000 });
// TimeoutError: GET /api/slow timed out after 1000 ms`,
    run: () => api.get("/slow", { timeout: 1000 }),
  },
  {
    title: "Cancel",
    description: `A cancel is not a failure: the request rejects with the signal's reason, the standard AbortError, and onError is not called. Press Abort within ${SLOW_DELAY / 1000} s.`,
    path: "/api/export",
    code: `const controller = new AbortController();
const pending = api.get("/export", { signal: controller.signal });

controller.abort();
await pending; // DOMException "AbortError", not a library error`,
    run: (signal) => api.get("/export", { signal }),
    abortable: true,
  },
  {
    title: "NetworkError",
    description: "fetch itself rejected: offline, DNS, CORS. The original error is the cause.",
    path: "/api/unreachable",
    code: `await api.get("/unreachable");
// NetworkError, cause: TypeError "Failed to fetch"`,
    run: () => api.get("/unreachable"),
  },
  {
    title: "ParseError",
    description: "A 200 whose body is not valid JSON. The parser's error is the cause.",
    path: "/api/broken-json",
    code: `await api.get("/broken-json");
// ParseError, cause: SyntaxError`,
    run: () => api.get("/broken-json"),
  },
  {
    title: "SchemaError",
    description:
      "The data does not match the schema (Zod here; any Standard Schema library works). With a schema, data is typed from it.",
    path: "/api/orders",
    code: `const Order = z.object({
  items: z.array(z.object({ id: z.number(), price: z.number() })),
});

const { data } = await api.get("/orders", { schema: Order });
// data: { items: { id: number; price: number }[] }`,
    run: () => api.get("/orders", { schema: Order }),
  },
];

interface Described {
  name: string;
  message: string;
  fields: [string, string][];
}

const json = (value: unknown): string => JSON.stringify(value);

const causeOf = (error: Error): string =>
  error.cause instanceof Error
    ? `${error.cause.name}: ${error.cause.message}`
    : String(error.cause);

function describe(error: unknown): Described {
  if (error instanceof HttpError) {
    return {
      name: error.name,
      message: error.message,
      fields: [
        ["status", String(error.status)],
        ["statusText", error.statusText],
        ["data", json(error.data)],
      ],
    };
  }
  if (error instanceof TimeoutError) {
    return {
      name: error.name,
      message: error.message,
      fields: [
        ["timeout", String(error.timeout)],
        ["cause", causeOf(error)],
      ],
    };
  }
  if (error instanceof NetworkError) {
    return { name: error.name, message: error.message, fields: [["cause", causeOf(error)]] };
  }
  if (error instanceof ParseError) {
    return {
      name: error.name,
      message: error.message,
      fields: [
        ["response.status", String(error.response.status)],
        ["cause", causeOf(error)],
      ],
    };
  }
  if (error instanceof SchemaError) {
    return {
      name: error.name,
      message: error.message,
      fields: [
        ...error.issues.map((issue, index): [string, string] => [
          `issues[${index}]`,
          `path ${json(issue.path)}: ${issue.message}`,
        ]),
        ["data", json(error.data)],
      ],
    };
  }
  if (error instanceof DOMException) {
    return {
      name: `DOMException "${error.name}"`,
      message: error.message,
      fields: [["a library error", "no: the signal's reason, as with plain fetch"]],
    };
  }
  return { name: "Unexpected", message: String(error), fields: [] };
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const timeline = useTimeline();
  const [from, setFrom] = useState<number | null>(null);
  const [result, setResult] = useState<Described | null>(null);
  const controller = useRef<AbortController | null>(null);

  const pending = from !== null && result === null;

  async function run(): Promise<void> {
    setFrom(nextEntryId());
    setResult(null);
    controller.current = new AbortController();
    try {
      // Every scenario fails, unless the cancel comes too late.
      const { status, data } = await scenario.run(controller.current.signal);
      setResult({ name: "Resolved", message: `${status} ${json(data)}`, fields: [] });
    } catch (error) {
      setResult(describe(error));
    }
    controller.current = null;
  }

  // The hooks are called before the promise settles, so they are all in the timeline by now.
  const hooks =
    from === null
      ? []
      : timeline
          .slice(from)
          .filter((entry) => entry.source === "client" && entry.path === scenario.path)
          .map((entry) => entry.label);

  return (
    <section className="card scenario" data-scenario={scenario.title}>
      <h2>{scenario.title}</h2>
      <p className="intro">{scenario.description}</p>
      <pre>
        <code>{scenario.code}</code>
      </pre>
      <div className="actions">
        <button type="button" className="primary" disabled={pending} onClick={() => void run()}>
          {pending ? "Waiting..." : "Send"}
        </button>
        {scenario.abortable === true && (
          <button type="button" disabled={!pending} onClick={() => controller.current?.abort()}>
            Abort
          </button>
        )}
      </div>
      {result !== null && (
        <div className="error-result" aria-live="polite">
          <p className="error-name">{result.name}</p>
          <p className="error-message">{result.message}</p>
          <dl className="fields-list">
            {result.fields.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <div>
              <dt>hooks</dt>
              <dd>
                {hooks.join(", ")}
                {hooks.includes("onError") ? "" : " (onError not called)"}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

export function ErrorsScreen() {
  return (
    <>
      <p className="intro">
        Every failure of a sent request is one of five classes, each with the request and the fields
        that matter for it. <code>onError</code> sees each of them once. The fake server produces
        every case on demand.
      </p>
      {SCENARIOS.map((scenario) => (
        <ScenarioCard key={scenario.title} scenario={scenario} />
      ))}
    </>
  );
}
