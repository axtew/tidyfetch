import { describe, expectTypeOf, test } from "vitest";

import { createClient, type HttpResponse } from "../..";

interface User {
  id: number;
  name: string;
}

const api = createClient({ baseUrl: "/api" });

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
});
