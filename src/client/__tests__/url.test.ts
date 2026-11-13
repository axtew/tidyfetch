import { describe, expect, it, vi } from "vitest";

import { createClient, type FetchFunction, type Query } from "../..";
import { recordingFetch, rejectionOf } from "./_helpers";

async function urlFor(baseUrl: string, path: string, query?: Query): Promise<string> {
  const { fetch, last } = recordingFetch();
  const api = createClient({ baseUrl, fetch });
  await api.get(path, query === undefined ? {} : { query });
  return last().url;
}

describe("URL building", () => {
  it("works with a relative baseUrl and a query", async () => {
    expect(await urlFor("/api", "/sites", { page: 2 })).toBe("/api/sites?page=2");
  });

  it.each([
    ["/api", "users", "/api/users"],
    ["/api/", "users", "/api/users"],
    ["/api", "/users", "/api/users"],
    ["/api/", "/users", "/api/users"],
    ["/api//", "//users", "/api/users"],
    ["https://example.com/v1/", "/users/1", "https://example.com/v1/users/1"],
    ["https://example.com", "users", "https://example.com/users"],
    ["/", "users", "/users"],
  ])("joins %s and %s with one slash", async (baseUrl, path, expected) => {
    expect(await urlFor(baseUrl, path)).toBe(expected);
  });

  it("uses the baseUrl as is for an empty path", async () => {
    expect(await urlFor("/api/items", "")).toBe("/api/items");
  });

  it.each(["https://cdn.example.com/file.json", "HTTP://example.com/a", "ws://example.com/socket"])(
    "sends %s past the baseUrl",
    async (path) => {
      expect(await urlFor("/api", path)).toBe(path);
    },
  );

  it("appends the query with & when the path already has one", async () => {
    expect(await urlFor("/api", "/items?sort=name", { page: 2 })).toBe(
      "/api/items?sort=name&page=2",
    );
    expect(await urlFor("/api", "/items?", { page: 2 })).toBe("/api/items?page=2");
  });

  it("puts the query before a #hash", async () => {
    expect(await urlFor("/api", "/doc#part", { page: 2 })).toBe("/api/doc?page=2#part");
    expect(await urlFor("/api", "/doc?a=1#part", { page: 2 })).toBe("/api/doc?a=1&page=2#part");
  });

  it("leaves the URL alone when the query is empty", async () => {
    expect(await urlFor("/api", "/items", {})).toBe("/api/items");
    expect(await urlFor("/api", "/items", { a: undefined, b: null })).toBe("/api/items");
  });
});

describe("query values", () => {
  it("repeats the key for an array", async () => {
    expect(await urlFor("/api", "/x", { id: [1, 2, 3] })).toBe("/api/x?id=1&id=2&id=3");
  });

  it("writes booleans as true and false", async () => {
    expect(await urlFor("/api", "/x", { active: true, archived: false })).toBe(
      "/api/x?active=true&archived=false",
    );
  });

  it("skips null and undefined, also inside arrays", async () => {
    const query = { a: null, b: undefined, c: [1, null, undefined, 2], d: 0, e: "" };
    expect(await urlFor("/api", "/x", query)).toBe("/api/x?c=1&c=2&d=0&e=");
  });

  it("accepts URLSearchParams", async () => {
    const params = new URLSearchParams([
      ["tag", "a"],
      ["tag", "b"],
    ]);
    expect(await urlFor("/api", "/x", params)).toBe("/api/x?tag=a&tag=b");
  });

  it("encodes special characters", async () => {
    const url = await urlFor("/api", "/x", { q: "a&b=c d/é?#", "k[]": "1" });
    expect(url).toBe("/api/x?q=a%26b%3Dc+d%2F%C3%A9%3F%23&k%5B%5D=1");
    expect(new URLSearchParams(url.split("?")[1]).get("q")).toBe("a&b=c d/é?#");
  });
});

describe("query values the types cannot check", () => {
  interface Filters {
    page: number;
    tags?: string[];
  }

  it("accepts an interface-typed object", async () => {
    const filters: Filters = { page: 2, tags: ["a", "b"] };
    expect(await urlFor("/api", "/x", { ...filters })).toBe("/api/x?page=2&tags=a&tags=b");

    const { fetch, last } = recordingFetch();
    await createClient({ baseUrl: "/api", fetch }).get<string[]>("/x", { query: filters });
    expect(last().url).toBe("/api/x?page=2&tags=a&tags=b");
  });

  it.each<[string, unknown]>([
    ["a Date", new Date(0)],
    ["a nested object", { a: 1 }],
    ["an object in an array", [1, { a: 1 }]],
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
  ])("throws TypeError naming the key for %s, before calling fetch", async (_name, value) => {
    const fetch = vi.fn<FetchFunction>();
    const api = createClient({ baseUrl: "/api", fetch });
    // Typed as `object`, as an explicit `T` would leave it: the types let it through.
    const query: object = { ok: 1, bad: value };

    const error = await rejectionOf(api.get("/x", { query }), TypeError);

    expect(error.message).toContain('"bad"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws TypeError for a query that is not an object (untyped callers)", async () => {
    const api = createClient({ baseUrl: "/api", fetch: vi.fn<FetchFunction>() });
    const query: unknown = "page=1";

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    await expect(api.get("/x", { query: query as object })).rejects.toThrow(TypeError);
  });
});
