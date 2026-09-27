import { describe, expect, it } from "vitest";
import { selectionMenuRequest } from "../../../../src/renderer/features/editor/selection-request";

/**
 * Permanent suite. Consumer: EditorPane's contextmenu handler — it
 * dispatches on null (no menu) vs a request (menu at the pointer,
 * carrying the selection that will ride the turn, and the offset the
 * language operations aim at). The verbatim clause is load-bearing:
 * the prompt's fenced text is the model's only view of what the user
 * highlighted. The empty-selection clause is the language menu's
 * door: a right-click with no selection still opens — for classified
 * files only, aiming language ops at the clicked word.
 */

const range = { from: 0, to: 0, empty: true };

describe("selectionMenuRequest", () => {
  it("returns null for an empty selection on an unclassified file — native behavior", () => {
    expect(
      selectionMenuRequest("/ws/notes.txt", range, "", { x: 10, y: 20 }, 5),
    ).toBeNull();
  });

  it("returns null when the range is non-empty but yields no text", () => {
    expect(
      selectionMenuRequest(
        "/ws/a.ts",
        { ...range, empty: false },
        "",
        {
          x: 10,
          y: 20,
        },
        3,
      ),
    ).toBeNull();
  });

  it("opens for an empty selection on a classified file, aiming at the clicked word", () => {
    expect(
      selectionMenuRequest("/ws/a.ts", range, "", { x: 130, y: 240 }, 42),
    ).toEqual({
      path: "/ws/a.ts",
      selection: "",
      x: 130,
      y: 240,
      symbolOffset: 42, // language ops target the click point
    });
  });

  it("builds the request from a non-empty selection: path, verbatim text, pointer position — language ops aim at the selection", () => {
    expect(
      selectionMenuRequest(
        "/ws/a.ts",
        { from: 4, to: 17, empty: false },
        "const x = 1;\nconst y = 2;",
        { x: 130, y: 240 },
        99,
      ),
    ).toEqual({
      path: "/ws/a.ts",
      selection: "const x = 1;\nconst y = 2;",
      x: 130,
      y: 240,
      symbolOffset: 17, // the selection's end, NOT the click point
    });
  });

  it("classifies case-insensitively — .PY is a language file too", () => {
    expect(
      selectionMenuRequest("/ws/script.PY", range, "", { x: 0, y: 0 }, 0),
    ).toEqual({
      path: "/ws/script.PY",
      selection: "",
      x: 0,
      y: 0,
      symbolOffset: 0,
    });
  });
});
