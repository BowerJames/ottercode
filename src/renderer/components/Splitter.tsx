import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

type SplitterProps = {
  axis: "x" | "y";
  title?: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture?: (e: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick?: (e: ReactMouseEvent<HTMLElement>) => void;
};

/**
 * The visible drag handle between panels. Dumb by design: it owns
 * pixels and cursor only — drag math, clamping, and reset live in
 * usePanelSize (app/), whose `handleProps` spread straight in. The
 * handler props are structurally exactly what that hook returns.
 */
export function Splitter({ axis, title, ...handlers }: SplitterProps) {
  return (
    // <hr> carries role=separator natively — the semantic element the
    // lint rightly asks for; CSS makes it a grab zone instead of a rule.
    <hr
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      className={`splitter splitter-${axis}`}
      title={title}
      {...handlers}
    />
  );
}
