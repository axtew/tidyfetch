import { describe, expect, it } from "vitest";

import {
  createClient,
  HttpError,
  type HttpRequest,
  NetworkError,
  ParseError,
  TimeoutError,
} from "../..";
import { rejectionOf } from "../../client/__tests__/_helpers";

const request: HttpRequest = { method: "GET", url: "/api/x", headers: new Headers() };

const errors = [
  [
    "HttpError",
    () =>
      new HttpError({ request, response: new Response(null, { status: 500 }), data: undefined }),
  ],
  ["TimeoutError", () => new TimeoutError({ request, timeout: 10 })],
  ["NetworkError", () => new NetworkError({ request, cause: new TypeError("fetch failed") })],
  [
    "ParseError",
    () => new ParseError({ request, response: new Response(), cause: new SyntaxError("x") }),
  ],
] as const;

const classes = [HttpError, TimeoutError, NetworkError, ParseError];

describe("error classes", () => {
  it.each(errors)("%s is an Error with its own name and a stack", (name, make) => {
    const error = make();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(String(error)).toMatch(new RegExp(`^${name}: `));
    expect(error.stack).toContain(name);
    expect(error.request).toBe(request);
  });

  it.each(errors)("%s is an instance of its own class only", (_name, make) => {
    const error = make();

    expect(classes.filter((errorClass) => error instanceof errorClass)).toHaveLength(1);
  });

  it("keeps the cause (ES2022)", () => {
    const cause = new TypeError("fetch failed");

    expect(new NetworkError({ request, cause }).cause).toBe(cause);
    expect(new ParseError({ request, response: new Response(), cause }).cause).toBe(cause);
    expect(new TimeoutError({ request, timeout: 1, cause }).cause).toBe(cause);
  });
});

describe("HttpError from a response", () => {
  it("carries status, statusText, parsed data, the response and the request", async () => {
    const api = createClient({
      baseUrl: "/api",
      headers: { Authorization: "Bearer t" },
      fetch: () =>
        Promise.resolve(
          new Response('{"message":"no such site"}', {
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/json" },
          }),
        ),
    });

    const error = await rejectionOf(api.get("/sites", { query: { id: 7 } }), HttpError);

    expect(error.message).toBe("GET /api/sites?id=7 failed with 404 Not Found");
    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
    expect(error.data).toEqual({ message: "no such site" });
    expect(error.response).toBeInstanceOf(Response);
    expect(error.response.status).toBe(404);
    expect(error.request.method).toBe("GET");
    expect(error.request.url).toBe("/api/sites?id=7");
    expect(error.request.headers.get("authorization")).toBe("Bearer t");
  });

  it("leaves the status text out of the message when there is none (HTTP/2)", async () => {
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(new Response("oops", { status: 500 })),
    });

    const error = await rejectionOf(api.delete("/x"), HttpError);

    expect(error.message).toBe("DELETE /api/x failed with 500");
    expect(error.data).toBe("oops");
  });

  it.each([400, 401, 403, 409, 422, 500, 503])("is thrown for %i", async (status) => {
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(new Response(null, { status })),
    });

    await expect(api.get("/x")).rejects.toMatchObject({ name: "HttpError", status });
  });
});
