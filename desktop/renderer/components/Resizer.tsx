import { useCallback } from "react";

/**
 * A thin drag handle that resizes a panel by writing a CSS variable on :root. `dir` is +1 when the
 * panel grows as you drag right (left-edge panels) and -1 when it grows as you drag left (right-edge).
 * The width is clamped to [min, max] and persisted to localStorage so it survives reloads.
 */
export function Resizer({ cssVar, min, max, dir, className = "" }: { cssVar: string; min: number; max: number; dir: 1 | -1; className?: string }) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || min;
      const move = (ev: PointerEvent) => {
        const w = Math.max(min, Math.min(max, start + dir * (ev.clientX - startX)));
        document.documentElement.style.setProperty(cssVar, w + "px");
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          localStorage.setItem(cssVar, getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim());
        } catch {
          /* storage unavailable */
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [cssVar, min, max, dir],
  );
  return <div className={"resizer " + className} onPointerDown={onPointerDown} role="separator" aria-orientation="vertical" />;
}

/** Restore saved panel widths (and set defaults) — call once on app mount. */
export function initPanelWidths(defaults: Record<string, string>): void {
  for (const [v, def] of Object.entries(defaults)) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(v);
    } catch {
      /* ignore */
    }
    document.documentElement.style.setProperty(v, saved || def);
  }
}
