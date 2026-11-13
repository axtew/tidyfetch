import { describe, expect, it } from "vitest";

import {
  createClient,
  HttpError,
  type HttpRequest,
  NetworkError,
  ParseError,
  SchemaError,
  type StandardSchemaV1,
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
  [
    "SchemaError",
    () =>
      new SchemaError({ request, response: new Response(), data: {}, issues: [{ message: "x" }] }),
  ],
] as const;

const classes = [HttpError, TimeoutError, NetworkError, ParseError, SchemaError];

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

const messageOf = (issues: StandardSchemaV1.Issue[]): string =>
  new SchemaError({ request, response: new Response(), data: null, issues }).message;

describe("SchemaError message", () => {
  const prefix = "GET /api/x: response does not match the schema";

  it("shows the first issue with its path, and how many follow", () => {
    expect(
      messageOf([
        { message: "Invalid email", path: ["user", "email"] },
        { message: "Required", path: ["user", "name"] },
        { message: "Required", path: ["id"] },
      ]),
    ).toBe(`${prefix}: user.email: Invalid email (and 2 more issues)`);
  });

  it("says issue for one more", () => {
    expect(messageOf([{ message: "a" }, { message: "b" }])).toBe(`${prefix}: a (and 1 more issue)`);
  });

  it("puts array indexes in brackets and reads path segment objects", () => {
    expect(
      messageOf([{ message: "Expected string", path: [{ key: "items" }, 0, { key: "name" }] }]),
    ).toBe(`${prefix}: items[0].name: Expected string`);
    expect(messageOf([{ message: "Too short", path: [2] }])).toBe(`${prefix}: [2]: Too short`);
  });

  it("leaves out an empty or missing path", () => {
    expect(messageOf([{ message: "Expected object", path: [] }])).toBe(
      `${prefix}: Expected object`,
    );
    expect(messageOf([{ message: "Expected object" }])).toBe(`${prefix}: Expected object`);
  });

  it("has no details when there are no issues", () => {
    expect(messageOf([])).toBe(prefix);
  });

  it("keeps the issues, the data, the response and the request", () => {
    const issues = [{ message: "x" }];
    const response = new Response();
    const error = new SchemaError({ request, response, data: { a: 1 }, issues });

    expect(error.issues).toBe(issues);
    expect(error.data).toEqual({ a: 1 });
    expect(error.response).toBe(response);
    expect(error.request).toBe(request);
    expect(error.cause).toBeUndefined();
  });
});
