import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../../src/renderer/components/Markdown";

/**
 * Permanent suite — one pin, two consumers: the chat transcript and
 * the editor's markdown preview both render through Markdown, and the
 * clause every surface relies on is that raw HTML is NEVER
 * interpreted as markup. Rendered text is untrusted content — agent
 * output or files on disk; an injected element must not survive as an
 * element.
 *
 * Deliberately unpinned: markdown-to-HTML correctness (bold, lists,
 * fences). That is the library's behaviour — pinning it would only
 * freeze the adapter choice behind this module's seam.
 *
 * The GFM table pin is policy, not library behaviour: react-markdown
 * alone speaks vanilla CommonMark, and the plugin wiring inside
 * Markdown is the deliberate decision that files and agent output
 * written against GFM (the dialect editors expect) render as tables.
 * Drop the wiring and both surfaces break — so the clause is pinned.
 */
describe("Markdown", () => {
  it("never renders raw HTML as elements", () => {
    const html = renderToString(
      createElement(Markdown, {
        text: 'hello <img src=x onerror="alert(1)"> world',
      }),
    );

    // Whatever the mechanism (dropped or escaped), an element must not
    // appear — while the surrounding text still renders.
    expect(html).not.toContain("<img");
    expect(html).toContain("hello");
    expect(html).toContain("world");
  });

  it("renders GFM pipe tables as tables", () => {
    const html = renderToString(
      createElement(Markdown, {
        text: "| a | b |\n| --- | --- |\n| 1 | 2 |",
      }),
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
    // The header cells' text must land in cells, not in stray pipes.
    expect(html).not.toContain("| a");
  });
});
