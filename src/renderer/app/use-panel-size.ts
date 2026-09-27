import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

/**
 * Panel sizing for the shell's resizable containers (sidebar, agent
 * rail, terminal dock). The behaviour module of the resize seam: drag
 * math, clamping, and double-click reset live here; the visible handle
 * is the dumb Splitter, which these `handleProps` spread into.
 *
 * Presentation state only — width/height is not persisted (same
 * precedent as the chat gates). When persistence lands it belongs
 * inside this hook: one place, every panel benefits.
 */
export type PanelSizeOptions = {
  /** Which pointer axis drives the size. */
  axis: "x" | "y";
  /** Clamp floor — the panel stays usable. */
  min: number;
  /** Clamp ceiling. */
  max: number;
  /** Starting size, and the double-click reset target. */
  initial: number;
  /** True when the panel is anchored at the far side of its axis
   * (right edge or bottom): dragging AGAINST the axis grows it. */
  invert?: boolean;
};

/** Everything a drag handle needs; spread onto a Splitter. */
export type PanelHandleProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  // The universal drag end: capture is lost for ANY reason — pointerup,
  // pointercancel, the element going away — so this is the one cleanup
  // path. Listening for pointerup alone would leak drag state on
  // cancel (browser gesture steals the pointer).
  onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
};

export function usePanelSize(opts: PanelSizeOptions): {
  size: number;
  handleProps: PanelHandleProps;
} {
  const [size, setSize] = useState(opts.initial);
  // Live-drag origin: pointer position and panel size at grab. Null
  // when not dragging — the sole drag-state authority.
  const drag = useRef<{ pointer: number; start: number } | null>(null);

  // Pointer capture keeps the move/up stream on the handle element —
  // no window listeners to leak, no missed ups when the cursor
  // outruns the handle.
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault(); // no text selection under the handle
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        pointer: opts.axis === "x" ? e.clientX : e.clientY,
        start: size,
      };
      // Global drag signal: the resize cursor everywhere and no
      // selection anywhere while the drag lives.
      document.body.classList.add(`panel-resizing-${opts.axis}`);
    },
    [opts.axis, size],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (d === null) return;
      const current = opts.axis === "x" ? e.clientX : e.clientY;
      const delta = (current - d.pointer) * (opts.invert === true ? -1 : 1);
      setSize(Math.min(opts.max, Math.max(opts.min, d.start + delta)));
    },
    [opts.axis, opts.invert, opts.max, opts.min],
  );

  const onLostPointerCapture = useCallback(() => {
    if (drag.current === null) return;
    drag.current = null;
    document.body.classList.remove(`panel-resizing-${opts.axis}`);
    // Capture releases itself when the pointer leaves it — arriving
    // here IS the release.
  }, [opts.axis]);

  const onDoubleClick = useCallback(() => {
    drag.current = null;
    setSize(opts.initial);
  }, [opts.initial]);

  return {
    size,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onLostPointerCapture,
      onDoubleClick,
    },
  };
}
