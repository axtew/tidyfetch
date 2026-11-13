import * as v from "valibot";
import { describe, expectTypeOf, test } from "vitest";
import { z } from "zod";

import { createClient, type HttpResponse, type StandardSchemaV1 } from "../..";

const api = createClient({ baseUrl: "/api" });

interface User {
  id: number;
  name: string;
  role: string;
}

describe("data is the schema's output", () => {
  test("zod, transforms and defaults included", async () => {
    const schema = z.object({
      id: z.string().transform(Number),
      name: z.string(),
      role: z.string().default("user"),
    });

    const { data } = await api.get("/me", { schema });

    expectTypeOf(data).toEqualTypeOf<User>();
    expectTypeOf(api.post("/users", { schema, body: {} })).resolves.toEqualTypeOf<
      HttpResponse<User>
    >();
  });

  test("valibot, transforms and defaults included", async () => {
    const schema = v.object({
      id: v.pipe(v.string(), v.transform(Number)),
      name: v.string(),
      role: v.optional(v.string(), "user"),
    });

    const { data } = await api.get("/me", { schema });

    expectTypeOf(data).toEqualTypeOf<User>();
  });

  test("async schemas", async () => {
    const zodAsync = z.object({ login: z.string().refine(async () => true) });
    const valibotAsync = v.objectAsync({ login: v.string() });

    expectTypeOf((await api.get("/x", { schema: zodAsync })).data).toEqualTypeOf<{
      login: string;
    }>();
    expectTypeOf((await api.get("/x", { schema: valibotAsync })).data).toEqualTypeOf<{
      login: string;
    }>();
  });

  test("an array schema, through every method", async () => {
    const schema = z.array(z.object({ id: z.number() }));
    type Items = { id: number }[];

    expectTypeOf((await api.request("GET", "/x", { schema })).data).toEqualTypeOf<Items>();
    expectTypeOf((await api.put("/x", { schema })).data).toEqualTypeOf<Items>();
    expectTypeOf((await api.patch("/x", { schema })).data).toEqualTypeOf<Items>();
    expectTypeOf((await api.delete("/x", { schema })).data).toEqualTypeOf<Items>();
  });

  test("the schema wins over responseType", async () => {
    const schema = z.string().transform((text) => text.split(","));

    const { data } = await api.get("/csv", { schema, responseType: "text" });

    expectTypeOf(data).toEqualTypeOf<string[]>();
  });

  test("a hand-written Standard Schema", async () => {
    const schema: StandardSchemaV1<unknown, Date> = {
      "~standard": {
        version: 1,
        vendor: "custom",
        validate: (value) => ({ value: new Date(String(value)) }),
      },
    };

    expectTypeOf((await api.get("/now", { schema })).data).toEqualTypeOf<Date>();
  });
});

describe("schema with other options", () => {
  test("query and the rest keep working", async () => {
    interface Filters {
      page: number;
    }
    const filters: Filters = { page: 1 };
    const schema = z.object({ id: z.number() });

    const { data } = await api.get("/x", { schema, query: filters, timeout: 1_000 });

    expectTypeOf(data).toEqualTypeOf<{ id: number }>();
  });

  test("an explicit type argument and a schema do not go together", () => {
    const schema = z.object({ id: z.number() });

    // @ts-expect-error the type comes from the schema
    void api.get<User>("/x", { schema });
  });

  test("a schema must be a Standard Schema", () => {
    // @ts-expect-error not a Standard Schema
    void api.get("/x", { schema: { parse: (value: unknown) => value } });
    // @ts-expect-error not a Standard Schema
    void api.get("/x", { schema: (value: unknown) => value });
  });
});
