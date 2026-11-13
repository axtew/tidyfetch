import { describe, expectTypeOf, test } from "vitest";

import {
  createClient,
  type FetchFunction,
  type HeadersOption,
  type HttpClient,
  HttpError,
  type HttpRequest,
  type HttpResponse,
  NetworkError,
  ParseError,
  type RequestError,
  type RequestHeaders,
  type ResponseBodyType,
  type ResponseData,
  SchemaError,
  type StandardSchemaV1,
  TimeoutError,
} from "../..";

interface User {
  id: number;
  name: string;
}

const api = createClient({ baseUrl: "/api" });

// A value typed `X | undefined`, as an optional parameter passed through is.
const maybe = <T>(value: T): T | undefined => value;

describe("client options", () => {
  test("baseUrl is required", () => {
    // @ts-expect-error baseUrl is missing
    createClient({});
    // @ts-expect-error baseUrl is missing
    createClient({ headers: { a: "1" } });
  });

  test("an unknown option fails", () => {
    // @ts-expect-error not an option
    createClient({ baseUrl: "/api", unknownOption: true });
  });

  test("headers take any HeadersInit or a function returning it, sync or async", () => {
    createClient({ baseUrl: "/api", headers: { a: "1" } });
    createClient({ baseUrl: "/api", headers: new Headers() });
    createClient({ baseUrl: "/api", headers: [["a", "1"]] });
    createClient({ baseUrl: "/api", headers: () => ({ a: "1" }) });
    createClient({ baseUrl: "/api", headers: async () => new Headers() });
    // @ts-expect-error a header value is a string
    createClient({ baseUrl: "/api", headers: { a: 1 } });
  });

  test("credentials and fetch", () => {
    createClient({ baseUrl: "/api", credentials: "include", fetch: globalThis.fetch });
    // @ts-expect-error not a RequestCredentials value
    createClient({ baseUrl: "/api", credentials: "always" });
  });
});

describe("request options", () => {
  test("query takes scalars, readonly arrays of them and URLSearchParams", () => {
    const ids = [1, null, 2] as const;
    void api.get("/x", { query: { a: "s", b: 1, c: true, d: null, e: undefined, ids } });
    void api.get("/x", { query: new URLSearchParams() });
  });

  test("a wrong query value fails", () => {
    // @ts-expect-error a nested object is not a query value
    void api.get("/x", { query: { filter: { a: 1 } } });
    // @ts-expect-error a Date is not a query value
    void api.get("/x", { query: { from: new Date() } });
  });

  test("query takes an interface-typed object", () => {
    interface Filters {
      page: number;
      search?: string;
      ids: readonly number[];
      archived: boolean | null;
    }
    const filters: Filters = { page: 1, ids: [1], archived: null };
    void api.get("/x", { query: filters });
    void api.post("/x", { query: filters, body: {} });
    void api.request("GET", "/x", { query: filters });
    // A service method passing its optional params through.
    const getSites = (params?: Filters) => api.get<User[]>("/sites", { query: params });
    const findSites = (params?: Filters) => api.get("/sites", { query: params });
    void getSites();
    void findSites();
  });

  test("query takes a type alias and an object literal", () => {
    type Filters = { page: number; tags: string[] };
    const filters: Filters = { page: 1, tags: [] };
    void api.get("/x", { query: filters });
    void api.get("/x", { query: { page: 1, tags: ["a"] } });
  });

  test("query takes an interface also with the response type given explicitly", () => {
    interface Filters {
      page: number;
    }
    const filters: Filters = { page: 1 };
    void api.get<User>("/x", { query: filters });
    void api.delete<User>("/x", { query: filters });
  });

  test("a wrong value in an interface-typed query fails where the query is inferred", () => {
    interface WithDate {
      from: Date;
    }
    interface Nested {
      filter: { a: number };
    }
    const withDate: WithDate = { from: new Date() };
    const nested: Nested = { filter: { a: 1 } };
    // @ts-expect-error a Date is not a query value
    void api.get("/x", { query: withDate });
    // @ts-expect-error a nested object is not a query value
    void api.patch("/x", { query: nested });
    // @ts-expect-error an array of objects is not a query value
    void api.get("/x", { query: { ids: [{ id: 1 }] } });
  });

  test("query is an object, not a string", () => {
    // @ts-expect-error a ready query string is not accepted
    void api.get("/x", { query: "page=1" });
  });

  test("request headers may remove a client header with undefined, in the object form only", () => {
    void api.get("/x", { headers: { Authorization: undefined } });
    void api.get("/x", { headers: new Headers() });
    void api.get("/x", { headers: [["a", "1"]] });
    // @ts-expect-error a pair needs a string value
    void api.get("/x", { headers: [["a", undefined]] });
    // @ts-expect-error a header value is a string
    void api.get("/x", { headers: { a: 1 } });
  });

  test("client headers take no undefined", () => {
    // @ts-expect-error undefined only removes a client header from a request
    createClient({ baseUrl: "/api", headers: { a: undefined } });
  });

  test("timeout, signal and responseType", () => {
    createClient({ baseUrl: "/api", timeout: 0 });
    void api.get("/x", {
      timeout: 5_000,
      signal: new AbortController().signal,
      responseType: "arrayBuffer",
    });
    // @ts-expect-error not a response type
    void api.get("/x", { responseType: "document" });
    // @ts-expect-error timeout is in milliseconds
    void api.get("/x", { timeout: "5s" });
  });

  test("an unknown option fails, and get takes no body", () => {
    // @ts-expect-error not an option
    void api.post("/x", { unknownOption: true });
    // @ts-expect-error GET has no body
    void api.get("/x", { body: { a: 1 } });
  });
});

describe("response data", () => {
  test("is unknown by default", async () => {
    const { data } = await api.get("/me");
    expectTypeOf(data).toBeUnknown();
  });

  test("takes the type argument", async () => {
    const { data } = await api.get<User>("/me");
    expectTypeOf(data).toEqualTypeOf<User>();
    expectTypeOf(api.post<User>("/users", { body: { name: "a" } })).resolves.toEqualTypeOf<
      HttpResponse<User>
    >();
    expectTypeOf(api.request<User[]>("GET", "/users")).resolves.toEqualTypeOf<
      HttpResponse<User[]>
    >();
  });

  test("follows responseType", async () => {
    expectTypeOf((await api.get("/x", { responseType: "text" })).data).toEqualTypeOf<string>();
    expectTypeOf((await api.get("/x", { responseType: "blob" })).data).toEqualTypeOf<Blob>();
    expectTypeOf(
      (await api.post("/x", { responseType: "arrayBuffer" })).data,
    ).toEqualTypeOf<ArrayBuffer>();
    expectTypeOf((await api.request("GET", "/x", { responseType: "stream" })).data).toEqualTypeOf<
      ReadableStream<Uint8Array>
    >();
    expectTypeOf((await api.get("/x", { responseType: "json" })).data).toBeUnknown();
  });

  test("with an explicit type, takes responseType json only", async () => {
    expectTypeOf((await api.get<User>("/me", { responseType: "json" })).data).toEqualTypeOf<User>();
    // @ts-expect-error the type of a text body is string, not a type argument
    void api.get<User>("/me", { responseType: "text" });
    // @ts-expect-error leave the type argument out: data is a Blob
    void api.get<Blob>("/file", { responseType: "blob" });
  });

  test("an explicit type keeps the other options", async () => {
    interface Filters {
      page: number;
    }
    const filters: Filters = { page: 1 };
    const response = await api.get<User>("/me", {
      query: filters,
      headers: { a: "1" },
      timeout: 1_000,
      signal: new AbortController().signal,
      skipRefresh: true,
    });
    expectTypeOf(response.data).toEqualTypeOf<User>();
    expectTypeOf(
      (await api.post<User>("/users", { body: { name: "a" }, query: filters })).data,
    ).toEqualTypeOf<User>();
  });

  test("a responseType not known in advance gives unknown", async () => {
    const responseType = maybe<ResponseBodyType>("blob");

    expectTypeOf((await api.get("/x", { responseType })).data).toBeUnknown();
  });

  test("ResponseData spells the rule out", () => {
    type Schema = StandardSchemaV1<unknown, Date>;
    expectTypeOf<ResponseData<User, "json" | undefined, undefined>>().toEqualTypeOf<User>();
    expectTypeOf<ResponseData<User, "text" | "blob", undefined>>().toEqualTypeOf<string | Blob>();
    expectTypeOf<ResponseData<User, "text", Schema>>().toEqualTypeOf<Date>();
  });
});

describe("errors", () => {
  test("narrow with instanceof and carry typed fields", () => {
    const error: unknown = new Error("x");
    if (error instanceof HttpError) {
      expectTypeOf(error.name).toEqualTypeOf<"HttpError">();
      expectTypeOf(error.status).toBeNumber();
      expectTypeOf(error.data).toBeUnknown();
      expectTypeOf(error.response).toEqualTypeOf<Response>();
      expectTypeOf(error.request).toEqualTypeOf<HttpRequest>();
    }
    if (error instanceof TimeoutError) {
      expectTypeOf(error.name).toEqualTypeOf<"TimeoutError">();
      expectTypeOf(error.timeout).toBeNumber();
    }
    if (error instanceof NetworkError) {
      expectTypeOf(error.name).toEqualTypeOf<"NetworkError">();
      expectTypeOf(error.request.headers).toEqualTypeOf<Headers>();
    }
    if (error instanceof ParseError) {
      expectTypeOf(error.name).toEqualTypeOf<"ParseError">();
      expectTypeOf(error.response).toEqualTypeOf<Response>();
    }
    if (error instanceof SchemaError) {
      expectTypeOf(error.name).toEqualTypeOf<"SchemaError">();
      expectTypeOf(error.issues).toEqualTypeOf<readonly StandardSchemaV1.Issue[]>();
      expectTypeOf(error.data).toBeUnknown();
      expectTypeOf(error.response).toEqualTypeOf<Response>();
      expectTypeOf(error.request).toEqualTypeOf<HttpRequest>();
    }
  });

  test("RequestError narrows by name", () => {
    expectTypeOf<RequestError["request"]>().toEqualTypeOf<HttpRequest>();
    expectTypeOf<Extract<RequestError, { name: "SchemaError" }>>().toEqualTypeOf<SchemaError>();
    expectTypeOf<Extract<RequestError, { name: "HttpError" }>["status"]>().toBeNumber();
  });
});

describe("hooks", () => {
  test("get typed parameters", () => {
    createClient({
      baseUrl: "/api",
      onRequest: (request) => {
        expectTypeOf(request).toEqualTypeOf<HttpRequest>();
      },
      onResponse: (response, request) => {
        expectTypeOf(response).toEqualTypeOf<HttpResponse>();
        expectTypeOf(request).toEqualTypeOf<HttpRequest>();
      },
      onError: (error, request) => {
        expectTypeOf(error).toEqualTypeOf<RequestError>();
        expectTypeOf(request).toEqualTypeOf<HttpRequest>();
      },
    });
  });

  test("may be async and return anything", () => {
    createClient({
      baseUrl: "/api",
      onRequest: async () => {},
      onResponse: (response) => response.status,
      onError: async (error) => error.message,
    });
  });

  test("are functions", () => {
    // @ts-expect-error a hook is a function
    createClient({ baseUrl: "/api", onError: true });
  });
});

describe("refresh options", () => {
  test("refresh resolves a boolean, skipRefresh gets the request", () => {
    createClient({
      baseUrl: "/api",
      refresh: async () => true,
      skipRefresh: (request) => {
        expectTypeOf(request).toEqualTypeOf<HttpRequest>();
        return request.url.includes("/auth/");
      },
    });
    // @ts-expect-error refresh returns a promise
    createClient({ baseUrl: "/api", refresh: () => true });
    // @ts-expect-error refresh resolves true or false, not a token
    createClient({ baseUrl: "/api", refresh: async () => "token" });
    // @ts-expect-error skipRefresh on the client is a function
    createClient({ baseUrl: "/api", skipRefresh: true });
  });

  test("a request takes skipRefresh: true", () => {
    void api.get("/x", { skipRefresh: true });
    void api.post("/auth/refresh", { skipRefresh: true, body: {} });
    // @ts-expect-error skipRefresh on a request is a boolean
    void api.get("/x", { skipRefresh: () => true });
  });

  test("refresh may call the same client", () => {
    const client: HttpClient = createClient({
      baseUrl: "/api",
      refresh: async () => {
        await client.post("/auth/refresh", { skipRefresh: true });
        return true;
      },
    });
  });
});

describe("optional options take undefined", () => {
  test("request options", () => {
    const signal = maybe(new AbortController().signal);
    const timeout = maybe(1_000);
    const headers = maybe<RequestHeaders>({ a: "1" });
    const responseType = maybe<ResponseBodyType>("json");
    const skipRefresh = maybe(true);
    const query = maybe({ page: 1 });
    const body = maybe<unknown>({ a: 1 });
    const schema = maybe<StandardSchemaV1>({
      "~standard": { version: 1, vendor: "custom", validate: (value) => ({ value }) },
    });

    void api.get("/x", { signal, timeout, headers, responseType, skipRefresh, query });
    void api.post("/x", { signal, timeout, headers, responseType, skipRefresh, query, body });
    void api.request("PATCH", "/x", { signal, body, schema });
  });

  test("the case from a service: an optional signal passed through", () => {
    interface Filters {
      page?: number;
    }
    function getSites(params?: Filters, signal?: AbortSignal) {
      return api.get<User[]>("/sites", { query: params, signal });
    }
    expectTypeOf(getSites()).resolves.toEqualTypeOf<HttpResponse<User[]>>();
  });

  test("client options", () => {
    createClient({
      baseUrl: "/api",
      headers: maybe<HeadersOption>(() => ({ a: "1" })),
      credentials: maybe<RequestCredentials>("include"),
      timeout: maybe(0),
      fetch: maybe<FetchFunction>(globalThis.fetch),
      refresh: maybe(async () => true),
      skipRefresh: maybe((request: HttpRequest) => request.url === "/login"),
      onRequest: maybe((_request: HttpRequest) => {}),
      onResponse: maybe((_response: HttpResponse) => {}),
      onError: maybe((_error: RequestError) => {}),
    });
  });

  test("baseUrl stays required", () => {
    // @ts-expect-error baseUrl is required and takes no undefined
    createClient({ baseUrl: maybe("/api") });
  });
});
