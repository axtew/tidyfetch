import type { HttpRequest } from "../request";

const label = (request: HttpRequest): string => `${request.method} ${request.url}`;

export interface HttpErrorInit {
  request: HttpRequest;
  response: Response;
  data: unknown;
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

  constructor({ request, response, data }: HttpErrorInit) {
    // HTTP/2 has no status text, so it may be empty.
    const status = `${response.status} ${response.statusText}`.trim();
    super(`${label(request)} failed with ${status}`);
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
