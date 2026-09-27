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
});
