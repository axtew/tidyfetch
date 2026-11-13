import type { HttpRequest } from "../request";
import type { StandardSchemaV1 } from "../schema";

const label = (request: HttpRequest): string => `${request.method} ${request.url}`;

export interface HttpErrorInit {
  request: HttpRequest;
  response: Response;
  data: unknown;
  /** Why the request was not retried, when there is a reason: the exception thrown by `refresh`. */
  cause?: unknown;
}

/** The server answered with a status outside 200-299. */
export class HttpError extends Error {
  override readonly name = "HttpError" as const;
  readonly status: number;
  readonly statusText: string;
  /** The error body, parsed by its content type; its text when it does not parse. */
  readonly data: unknown;
  /** The response; its body is already read into `data`. */
  readonly response: Response;
  readonly request: HttpRequest;

  constructor({ request, response, data, cause }: HttpErrorInit) {
    // HTTP/2 has no status text, so it may be empty.
    const status = `${response.status} ${response.statusText}`.trim();
    // No `cause` property at all unless there is one, as with a plain `new Error()`.
    super(`${label(request)} failed with ${status}`, cause === undefined ? undefined : { cause });
    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.response = response;
    this.request = request;
  }
}

export interface TimeoutErrorInit {
  request: HttpRequest;
  /** Milliseconds. */
  timeout: number;
  cause?: unknown;
}

/** The request did not finish within its `timeout`. */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError" as const;
  /** Milliseconds. */
  readonly timeout: number;
  readonly request: HttpRequest;

  constructor({ request, timeout, cause }: TimeoutErrorInit) {
    super(`${label(request)} timed out after ${timeout} ms`, { cause });
    this.timeout = timeout;
    this.request = request;
  }
}

export interface NetworkErrorInit {
  request: HttpRequest;
  cause: unknown;
}

/** `fetch` failed without a response: offline, DNS, CORS, a refused connection. */
export class NetworkError extends Error {
  override readonly name = "NetworkError" as const;
  readonly request: HttpRequest;

  constructor({ request, cause }: NetworkErrorInit) {
    super(`${label(request)} failed with a network error`, { cause });
    this.request = request;
  }
}

export interface ParseErrorInit {
  request: HttpRequest;
  response: Response;
  cause: unknown;
}

/** A successful response whose body does not parse as its type (broken JSON). */
export class ParseError extends Error {
  override readonly name = "ParseError" as const;
  /** The response; its body is already read. */
  readonly response: Response;
  readonly request: HttpRequest;

  constructor({ request, response, cause }: ParseErrorInit) {
    super(`${label(request)} returned a body that failed to parse`, { cause });
    this.response = response;
    this.request = request;
  }
}

export interface SchemaErrorInit {
  request: HttpRequest;
  response: Response;
  /** The parsed body that failed the check. */
  data: unknown;
  issues: readonly StandardSchemaV1.Issue[];
}

/** A successful response whose `data` does not pass the request `schema`. */
export class SchemaError extends Error {
  override readonly name = "SchemaError" as const;
  /** What the schema reported, in its own order. */
  readonly issues: readonly StandardSchemaV1.Issue[];
  /** The parsed body as it came, before the schema. */
  readonly data: unknown;
  /** The response; its body is already read into `data`. */
  readonly response: Response;
  readonly request: HttpRequest;

  constructor({ request, response, data, issues }: SchemaErrorInit) {
    super(`${label(request)}: response does not match the schema${describeIssues(issues)}`);
    this.issues = issues;
    this.data = data;
    this.response = response;
    this.request = request;
  }
}

/** `: user.email: Invalid email (and 2 more issues)`: the first issue, and how many follow. */
function describeIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  const [first, ...rest] = issues;
  if (first === undefined) return "";
  const path = formatPath(first.path ?? []);
  const more =
    rest.length === 0 ? "" : ` (and ${rest.length} more issue${rest.length === 1 ? "" : "s"})`;
  return `: ${path === "" ? "" : `${path}: `}${first.message}${more}`;
}

/** `items[0].name`: array indexes in brackets, other keys joined with dots. */
function formatPath(path: readonly (PropertyKey | StandardSchemaV1.PathSegment)[]): string {
  let text = "";
  for (const segment of path) {
    const key = typeof segment === "object" ? segment.key : segment;
    if (typeof key === "number") text += `[${key}]`;
    else text += text === "" ? String(key) : `.${String(key)}`;
  }
  return text;
}

/** Every error a sent request can fail with. A cancelled request rejects with the signal's reason instead. */
export type RequestError = HttpError | NetworkError | ParseError | SchemaError | TimeoutError;

export function isRequestError(error: unknown): error is RequestError {
  return (
    error instanceof HttpError ||
    error instanceof NetworkError ||
    error instanceof ParseError ||
    error instanceof SchemaError ||
    error instanceof TimeoutError
  );
}
