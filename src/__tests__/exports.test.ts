import { describe, expect, it } from "vitest";

import * as entry from "../index";

describe("entry point", () => {
  it("exports createClient and nothing else at runtime", () => {
    expect(Object.keys(entry)).toEqual(["createClient"]);
    expect(entry.createClient).toBeTypeOf("function");
  });
});
