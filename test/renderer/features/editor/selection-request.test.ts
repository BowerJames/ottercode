import { describe, expect, it } from "vitest";
import { selectionMenuRequest } from "../../../../src/renderer/features/editor/selection-request";

/**
 * Permanent suite. Consumer: EditorPane's contextmenu handler — it
 * dispatches on null (no menu) vs a request (menu at the pointer,
 * carrying the selection that will ride the turn). The verbatim
 * clause is load-bearing: the prompt's fenced text is the model's
 * only view of what the user highlighted.
 */

const range = { from: 0, to: 0, empty: true };

describe("selectionMenuRequest", () => {
  it("returns null for an empty selection — no menu, native behavior", () => {
    expect(
      selectionMenuRequest("/ws/a.ts", range, "", { x: 10, y: 20 }),
    ).toBeNull();
  });

  it("returns null when the range is non-empty but yields no text", () => {
    expect(
      selectionMenuRequest("/ws/a.ts", { ...range, empty: false }, "", {
        x: 10,
        y: 20,
      }),
    ).toBeNull();
  });

  it("builds the request from a non-empty selection: path, verbatim text, pointer position", () => {
    expect(
      selectionMenuRequest(
        "/ws/a.ts",
        { ...range, empty: false },
        "const x = 1;\nconst y = 2;",
        { x: 130, y: 240 },
      ),
    ).toEqual({
      path: "/ws/a.ts",
      selection: "const x = 1;\nconst y = 2;",
      x: 130,
      y: 240,
    });
  });
});
