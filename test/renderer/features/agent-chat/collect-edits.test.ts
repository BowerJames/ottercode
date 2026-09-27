import { describe, expect, it } from "vitest";
import { collectMessageEdits } from "../../../../src/renderer/features/agent-chat/collect-edits";
import type { VirtualDoc } from "../../../../src/renderer/features/editor/store";

/**
 * Permanent suite. Consumer: the composer — it gathers this collector's
 * output into agent:submit, so the clauses here are the turn's
 * attachment contract: WHICH drafts ride (dirty ones only), WHAT rides
 * (title + both versions — never the synthetic key, which must not
 * cross the wire), and in WHAT order (conversation order by entry id,
 * so the prompt lists corrections chronologically).
 */

function doc(over: Partial<VirtualDoc> & Pick<VirtualDoc, "title">) {
  return { draft: false, original: "", content: "", revision: 0, ...over };
}

describe("collectMessageEdits", () => {
  it("gathers dirty drafts — both versions, titled, in conversation order", () => {
    const docs: Record<string, VirtualDoc> = {
      // 10 sorts before 7 lexicographically — conversation order must
      // win, or the prompt lists corrections out of order.
      "virtual:chat/10": doc({
        title: "agent message #10",
        draft: true,
        original: "second message",
        content: "second message (corrected)",
      }),
      "virtual:chat/7": doc({
        title: "agent message #7",
        draft: true,
        original: "first message",
        content: "first message (corrected)",
      }),
      // Clean draft: no divergence, nothing to say — stays behind.
      "virtual:chat/3": doc({
        title: "agent message #3",
        draft: true,
        original: "untouched",
        content: "untouched",
      }),
      // Snapshot: structurally excluded (not a draft) even though a
      // future bug could make one dirty.
      "virtual:chat/4": doc({
        title: "your message #4",
        original: "user text",
        content: "user text",
      }),
    };

    expect(collectMessageEdits(docs)).toEqual([
      {
        title: "agent message #7",
        original: "first message",
        edited: "first message (corrected)",
      },
      {
        title: "agent message #10",
        original: "second message",
        edited: "second message (corrected)",
      },
    ]);
  });
});
