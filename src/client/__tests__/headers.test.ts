import { describe, expect, it } from "vitest";

import { createClient } from "../..";
import { recordingFetch } from "./_helpers";

describe("request headers add to the client headers instead of replacing them", () => {
  it("keeps Authorization when the request passes its own header", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", headers: { Authorization: "Bearer t" }, fetch });

    await api.get("/me", { headers: { "X-Trace": "1" } });

    expect(last().headers.get("authorization")).toBe("Bearer t");
    expect(last().headers.get("x-trace")).toBe("1");
  });

  it("lets the request win on the same name, case-insensitively", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", headers: { "Accept-Language": "en" }, fetch });

    await api.get("/me", { headers: { "accept-language": "ru" } });

    expect(last().headers.get("Accept-Language")).toBe("ru");
    expect([...last().headers.keys()]).toEqual(["accept-language"]);
  });
});

describe("every method sends the client headers", () => {
  const { fetch, calls } = recordingFetch();
  const api = createClient({ baseUrl: "/api", headers: { Authorization: "Bearer t" }, fetch });

  it.each([
    ["get", () => api.get("/x")],
    ["post", () => api.post("/x", { body: { a: 1 } })],
    ["put", () => api.put("/x", { body: { a: 1 } })],
    ["patch", () => api.patch("/x", { body: { a: 1 } })],
    ["delete", () => api.delete("/x")],
    ["request", () => api.request("OPTIONS", "/x")],
  ])("%s", async (_name, send) => {
    calls.length = 0;
    await send();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer t");
  });
});

describe("request headers in any HeadersInit form are merged", () => {
  it("accepts a Headers instance", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", headers: { Authorization: "Bearer t" }, fetch });

    await api.post("/x", { headers: new Headers({ "X-Trace": "1" }) });

    expect(last().headers.get("authorization")).toBe("Bearer t");
    expect(last().headers.get("x-trace")).toBe("1");
  });

  it("accepts an array of pairs, and client headers as Headers too", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({
      baseUrl: "/api",
      headers: new Headers([
        ["Authorization", "Bearer t"],
        ["Accept", "application/json"],
      ]),
      fetch,
    });

    await api.put("/x", {
      headers: [
        ["X-Trace", "1"],
        ["authorization", "Bearer other"],
      ],
    });

    expect(last().headers.get("authorization")).toBe("Bearer other");
    expect(last().headers.get("accept")).toBe("application/json");
    expect(last().headers.get("x-trace")).toBe("1");
  });
});

describe("client headers as a function", () => {
  it("is called on every request, so a changed token is sent", async () => {
    const { fetch, calls } = recordingFetch();
    let token = "first";
    const api = createClient({
      baseUrl: "/api",
      headers: () => ({ Authorization: `Bearer ${token}` }),
      fetch,
    });

    await api.get("/x");
    token = "second";
    await api.get("/x");

    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
      "Bearer first",
      "Bearer second",
    ]);
  });

  it("may be async", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({
      baseUrl: "/api",
      headers: async () => {
        await Promise.resolve();
        return [["X-Csrf-Token", "abc"]];
      },
      fetch,
    });

    await api.post("/x", { body: { a: 1 }, headers: { "X-Trace": "1" } });

    expect(last().headers.get("x-csrf-token")).toBe("abc");
    expect(last().headers.get("x-trace")).toBe("1");
  });
});

describe("undefined in the request headers removes a client header", () => {
  it("drops Authorization for one request, keeps the rest", async () => {
    const { fetch, calls } = recordingFetch();
    const api = createClient({
      baseUrl: "/api",
      headers: { Authorization: "Bearer t", Accept: "application/json" },
      fetch,
    });

    await api.put("https://bucket.s3.amazonaws.com/upload?sig=1", {
      headers: { Authorization: undefined },
    });
    await api.get("/me");

    expect(calls[0]?.headers.has("authorization")).toBe(false);
    expect(calls[0]?.headers.get("accept")).toBe("application/json");
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer t");
  });

  it("matches the name case-insensitively, also for function headers", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({
      baseUrl: "/api",
      headers: () => ({ "X-Csrf-Token": "abc", Authorization: "Bearer t" }),
      fetch,
    });

    await api.post("/x", { headers: { "x-csrf-token": undefined, AUTHORIZATION: undefined } });

    expect([...last().headers.keys()]).toEqual([]);
  });

  it("is a no-op for a header the client does not send", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", headers: { Accept: "text/plain" }, fetch });

    await api.get("/x", { headers: { "X-Missing": undefined, "X-Trace": "1" } });

    expect([...last().headers]).toEqual([
      ["accept", "text/plain"],
      ["x-trace", "1"],
    ]);
  });
});
