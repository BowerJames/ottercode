import { memo } from "react";
import ReactMarkdown from "react-markdown";

/**
 * Renders assistant text as markdown — the one rendering policy for
 * transcript text. Interface clauses every caller relies on:
 *
 * - Raw HTML in the text is NEVER interpreted as markup. Agent output
 *   is untrusted content; `rehype-raw` must never be added here. (The
 *   permanent suite pins this.)
 * - Links render as non-navigating text. An anchor click in Electron
 *   would navigate the window away from the app, and opening links
 *   externally would need a new contract channel — deferred until
 *   wanted, deliberately.
 * - Rendering tolerates partial markdown: the streaming tail entry
 *   re-renders on every delta (append-only accumulation is the chat
 *   store's clause), so unclosed fences and half-written emphasis must
 *   render sanely, never crash.
 *
 * Memoized on `text`: finalized entries never re-parse; only the
 * streaming tail pays the parse cost per delta. If long turns ever
 * jank, throttling lands INSIDE this module — callers see no change.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={{
          // Non-clickable link: keep the destination visible on hover,
          // drop the navigation (see clause above).
          a: ({ children, href }) => (
            <span className="md-link" title={href}>
              {children}
            </span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
