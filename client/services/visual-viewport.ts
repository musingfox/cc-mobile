/**
 * Publishes the visible viewport height as `--app-height` on <html>.
 *
 * The on-screen keyboard shrinks only the visual viewport — iOS Safari never
 * resizes the layout viewport for it — so a shell sized by 100vh keeps its
 * composer underneath the keys. styles.css sizes the shell from this variable
 * instead, falling back to 100vh/100svh until it is set.
 *
 * `height * scale` is the visible height in layout pixels, so a pinch-zoom,
 * which iOS allows despite `user-scalable=no`, leaves the app's height alone.
 */
export function bindVisualViewport(win: Window = window): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const root = win.document.documentElement;

  const publish = () => {
    root.style.setProperty("--app-height", `${vv.height * vv.scale}px`);
  };

  publish();
  vv.addEventListener("resize", publish);
  vv.addEventListener("scroll", publish);
  return () => {
    vv.removeEventListener("resize", publish);
    vv.removeEventListener("scroll", publish);
    root.style.removeProperty("--app-height");
  };
}
