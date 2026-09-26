import { describe, expect, it } from "vitest";
import { mapFsError } from "../../../src/main/workspace/map-fs-error.js";
import { fsError } from "./fake-dir-tree.js";

/**
 * Permanent suite (totality half only): the service depends on
 * mapFsError never throwing to keep its "failures come back as values"
 * promise, and the store's ok-branch consumes that. The specific code
 * mappings (EACCES -> permission-denied, …) had no consumer and were
 * deleted at the promotion review; re-pin them when a UI affordance
 * branches on error codes.
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
