import { describe, expect, it } from "vitest";

import * as entry from "../index";

describe("entry point", () => {
  it("loads", () => {
    expect(entry).toBeTypeOf("object");
  });
});
