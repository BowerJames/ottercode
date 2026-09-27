import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders text as markdown — the one rendering policy every markdown
 * surface in the app shares (the chat transcript; the editor's
 * preview). Interface clauses every caller relies on:
 *
 * - Table syntax (GFM pipe tables) renders as real tables, on every
 *   surface — files on disk and agent output are written against
 *   GFM, the dialect editors actually expect. That is why
 *   `remarkPlugins` stays pinned here: react-markdown alone speaks
 *   vanilla CommonMark, where pipes are just punctuation. The same
 *   plugin set also brings the rest of the GFM dialect (strikethrough,
 *   task lists, autolinks) along for free — all syntax-to-element
 *   rendering, which is distinct from the raw-HTML ban below.
 * - Raw HTML in the text is NEVER interpreted as markup. Rendered
 *   text is untrusted content — agent output or files on disk — and
 *   `rehype-raw` must never be added here. (The permanent suite pins
 *   this.)
 * - Links render as non-navigating text. An anchor click in Electron
 *   would navigate the window away from the app — true on every
 *   surface, chat or editor — and opening links externally would need
 *   a new contract channel — deferred until wanted, deliberately.
 * - Rendering tolerates partial markdown: the streaming tail entry
 *   re-renders on every delta (append-only accumulation is the chat
 *   store's clause), so unclosed fences and half-written emphasis must
 *   render sanely, never crash.
 *
 * Memoized on `text`: finalized entries never re-parse; only the
 * streaming tail pays the parse cost per delta. If long turns ever
 * jank, throttling lands INSIDE this module — callers see no change.
 *
 * Placement: components/ because two consumers make the seam real —
 * the chat transcript and the editor's markdown preview. The clauses
 * above travel with both: a file on disk is no safer to render as raw
 * HTML in this window than agent output. Surface differences (the
 * rail's tight rhythm vs. the pane's document scale) live in
 * container CSS, not props — the interface stays text in, elements
 * out.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
