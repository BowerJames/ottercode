import { describe, expect, it } from "vitest";
import { mapFsError } from "../../../src/main/workspace/map-fs-error.js";
import { fsError } from "./fake-dir-tree.js";

/**
 * Permanent suite (totality only): the service depends on mapFsError
 * never throwing to keep its "failures come back as values" promise,
 * and the stores' ok-branches consume that. The specific code mappings
 * have no computational consumer — the error banner renders text
 * nothing downstream computes with — so they stay unpinned until one
 * arrives.
 */

describe("mapFsError", () => {
  it("is total: anything unmappable yields unknown, nothing throws", () => {
    expect(mapFsError(fsError("EMFILE"))).toEqual({ code: "unknown" });
    expect(mapFsError(new Error("no code at all"))).toEqual({
      code: "unknown",
    });
    expect(mapFsError("not even an error")).toEqual({ code: "unknown" });
    expect(mapFsError(null)).toEqual({ code: "unknown" });
  });
});
