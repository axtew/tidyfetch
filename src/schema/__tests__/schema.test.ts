import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createClient, HttpError, SchemaError, type StandardSchemaV1 } from "../..";
import { fakeServer, json, rejectionOf, unauthorized } from "../../client/__tests__/_helpers";

/** A client whose `fetch` answers with `make()` every time. */
const clientAnswering = (make: () => Response) =>
  createClient({ baseUrl: "/api", fetch: () => Promise.resolve(make()) });

const zodUser = z.object({
  id: z.number(),
  email: z.email(),
  name: z.string().transform((name) => name.toUpperCase()),
  role: z.string().default("user"),
});

const valibotUser = v.object({
  id: v.number(),
  email: v.pipe(v.string(), v.email()),
  name: v.pipe(
    v.string(),
    v.transform((name) => name.toUpperCase()),
  ),
  role: v.optional(v.string(), "user"),
});

const validUser = { id: 1, email: "ann@example.com", name: "ann" };
const invalidUser = { id: "1", email: "not an email", name: "ann" };

describe.each([
  ["zod", zodUser],
  ["valibot", valibotUser],
])("with %s", (_library, schema) => {
  it("gives the schema's output: transforms and defaults apply", async () => {
    const api = clientAnswering(() => json(validUser));

    const { data } = await api.get("/me", { schema });

    expect(data).toEqual({ id: 1, email: "ann@example.com", name: "ANN", role: "user" });
  });

  it("throws SchemaError with the issues, the raw data, the response and the request", async () => {
    const api = clientAnswering(() => json(invalidUser));

    const error = await rejectionOf(api.get("/me", { schema }), SchemaError);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SchemaError");
    expect(error.issues).toHaveLength(2);
    expect(error.issues.map((issue) => issue.message)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    expect(error.message).toMatch(
      /^GET \/api\/me: response does not match the schema: id: .+ \(and 1 more issue\)$/,
    );
    expect(error.data).toEqual(invalidUser);
    expect(error.response.status).toBe(200);
    expect(error.request).toMatchObject({ method: "GET", url: "/api/me" });
  });

  it("is not applied to an error response", async () => {
    const api = clientAnswering(() => json({ message: "gone" }, 404));

    const error = await rejectionOf(api.get("/me", { schema }), HttpError);

    expect(error.data).toEqual({ message: "gone" });
  });
});

describe("async validation", () => {
  const taken = new Set(["ann"]);
  const zodAsync = z.object({
    login: z.string().refine(async (login) => !taken.has(login), "Login is taken"),
  });
  const valibotAsync = v.objectAsync({
    login: v.pipeAsync(
      v.string(),
      v.checkAsync(async (login) => !taken.has(login), "Login is taken"),
    ),
  });

  it.each([
    ["zod", zodAsync],
    ["valibot", valibotAsync],
  ])("with %s: passes and fails", async (_library, schema) => {
    expect(
      (await clientAnswering(() => json({ login: "bob" })).get("/x", { schema })).data,
    ).toEqual({ login: "bob" });

    const error = await rejectionOf(
      clientAnswering(() => json({ login: "ann" })).get("/x", { schema }),
      SchemaError,
    );
    expect(error.message).toBe(
      "GET /api/x: response does not match the schema: login: Login is taken",
    );
  });
});

/** A hand-written schema: the interface is all the library relies on. */
function customSchema(
  validate: StandardSchemaV1["~standard"]["validate"],
): StandardSchemaV1 & { validate: typeof validate } {
  const spy = vi.fn<StandardSchemaV1["~standard"]["validate"]>(validate);
  return { "~standard": { version: 1, vendor: "custom", validate: spy }, validate: spy };
}

describe("any Standard Schema", () => {
  it("gets the parsed data and gives its value", async () => {
    const schema = customSchema((value) => ({ value: { wrapped: value } }));
    const api = clientAnswering(() => json([1, 2]));

    const { data } = await api.get("/x", { schema });

    expect(schema.validate).toHaveBeenCalledExactlyOnceWith([1, 2]);
    expect(data).toEqual({ wrapped: [1, 2] });
  });

  it("gets the data as read by responseType", async () => {
    const schema = customSchema((value) => ({ value }));
    const api = clientAnswering(() => json({ a: 1 }));

    await api.get("/x", { schema, responseType: "text" });

    expect(schema.validate).toHaveBeenCalledWith('{"a":1}');
  });

  it("gets undefined for a response without a body", async () => {
    const schema = customSchema((value) => ({ value: value ?? "default" }));
    const api = clientAnswering(() => new Response(null, { status: 204 }));

    const { data } = await api.delete("/x", { schema });

    expect(schema.validate).toHaveBeenCalledWith(undefined);
    expect(data).toBe("default");
  });

  it("treats any falsy issues as success", async () => {
    // A schema may report success with `issues: undefined` set explicitly.
    const schema = customSchema((value) => ({ value, issues: undefined }));

    const { data } = await clientAnswering(() => json(1)).get("/x", { schema });

    expect(data).toBe(1);
  });

  it("lets an exception thrown by validate through as it is", async () => {
    const bug = new Error("schema bug");
    const schema = customSchema(() => {
      throw bug;
    });

    await expect(clientAnswering(() => json(1)).get("/x", { schema })).rejects.toBe(bug);
  });

  it("is not run on a response that fails to parse", async () => {
    const schema = customSchema((value) => ({ value }));
    const api = clientAnswering(
      () => new Response("{", { headers: { "content-type": "application/json" } }),
    );

    await expect(api.get("/x", { schema })).rejects.toMatchObject({ name: "ParseError" });
    expect(schema.validate).not.toHaveBeenCalled();
  });

  it("runs once, on the final response, after a refresh", async () => {
    const schema = customSchema((value) => ({ value }));
    let token = "old";
    const server = fakeServer((request) =>
      request.headers.get("authorization") === "new" ? json({ ok: 1 }) : unauthorized(),
    );
    const api = createClient({
      baseUrl: "/api",
      fetch: server.fetch,
      headers: () => ({ Authorization: token }),
      refresh: async () => {
        token = "new";
        return true;
      },
    });

    const { data } = await api.get("/x", { schema });

    expect(server.sent).toHaveLength(2);
    expect(schema.validate).toHaveBeenCalledExactlyOnceWith({ ok: 1 });
    expect(data).toEqual({ ok: 1 });
  });
});
