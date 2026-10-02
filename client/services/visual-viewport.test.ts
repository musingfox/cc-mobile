import { describe, expect, test } from "bun:test";
import { bindVisualViewport } from "./visual-viewport";

class FakeVisualViewport extends EventTarget {
  constructor(
    public height: number,
    public scale = 1,
  ) {
    super();
  }
}

function fakeWindow(vv: FakeVisualViewport | null) {
  const doc = document.implementation.createHTMLDocument("vv");
  return {
    win: { visualViewport: vv, document: doc } as unknown as Window,
    root: doc.documentElement,
  };
}

const appHeight = (root: HTMLElement) => root.style.getPropertyValue("--app-height");

describe("bindVisualViewport", () => {
  test("publishes the visible height as soon as it binds", () => {
    const { win, root } = fakeWindow(new FakeVisualViewport(844));

    bindVisualViewport(win);

    expect(appHeight(root)).toBe("844px");
  });

  test("follows the keyboard: a resize shrinks the published height", () => {
    const vv = new FakeVisualViewport(844);
    const { win, root } = fakeWindow(vv);
    bindVisualViewport(win);

    vv.height = 500;
    vv.dispatchEvent(new Event("resize"));

    expect(appHeight(root)).toBe("500px");
  });

  test("re-reads on scroll too, which is what iOS fires while panning", () => {
    const vv = new FakeVisualViewport(844);
    const { win, root } = fakeWindow(vv);
    bindVisualViewport(win);

    vv.height = 520;
    vv.dispatchEvent(new Event("scroll"));

    expect(appHeight(root)).toBe("520px");
  });

  test("a pinch-zoom does not shrink the app: height is scaled back to layout px", () => {
    const vv = new FakeVisualViewport(844);
    const { win, root } = fakeWindow(vv);
    bindVisualViewport(win);

    vv.height = 422;
    vv.scale = 2;
    vv.dispatchEvent(new Event("resize"));

    expect(appHeight(root)).toBe("844px");
  });

  test("unbinding stops following and hands the height back to CSS", () => {
    const vv = new FakeVisualViewport(844);
    const { win, root } = fakeWindow(vv);
    const unbind = bindVisualViewport(win);

    unbind();
    vv.height = 500;
    vv.dispatchEvent(new Event("resize"));

    expect(appHeight(root)).toBe("");
  });

  test("without visualViewport it does nothing and leaves CSS's fallback in place", () => {
    const { win, root } = fakeWindow(null);

    const unbind = bindVisualViewport(win);
    unbind();

    expect(appHeight(root)).toBe("");
  });
});
