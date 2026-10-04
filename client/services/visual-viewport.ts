/**
 * Publishes the visible area as `--app-height` and `--app-top` on <html>.
 *
 * The on-screen keyboard shrinks only the visual viewport — iOS Safari never
 * resizes the layout viewport for it — so a shell sized by 100vh keeps its
 * composer underneath the keys. iOS also pans the visual viewport down
 * (`offsetTop`) to bring the focused field into view, and a fixed element is
 * placed against the layout viewport, so a shell that only shrank stayed at
 * the layout top and slid out of sight above the visible area. styles.css
 * pins the shell to both values (MDN, Visual Viewport API, "Simulating
 * position: device-fixed").
 *
 * `height * scale` is the visible height in layout pixels, so a pinch-zoom,
 * which iOS allows despite `user-scalable=no`, leaves the app's height alone;
 * for the same reason a zoomed pan does not move it.
 */
export function bindVisualViewport(win: Window = window): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const root = win.document.documentElement;

  const publish = () => {
    root.style.setProperty("--app-height", `${vv.height * vv.scale}px`);
    root.style.setProperty("--app-top", `${vv.scale === 1 ? vv.offsetTop : 0}px`);
  };

  publish();
  vv.addEventListener("resize", publish);
  vv.addEventListener("scroll", publish);
  return () => {
    vv.removeEventListener("resize", publish);
    vv.removeEventListener("scroll", publish);
    root.style.removeProperty("--app-height");
    root.style.removeProperty("--app-top");
  };
}
