import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../../../src/renderer/features/agent-chat/Markdown";

/**
 * Permanent suite — one pin, one consumer: every transcript surface
 * renders assistant text through Markdown, and the clause every one
 * of them relies on is that raw HTML in agent output is NEVER
 * interpreted as markup. Agent text is untrusted content; an injected
 * element must not survive as an element.
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
