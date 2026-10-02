import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { LOOPBACK_LINK_NOTE } from "../utils/loopback-url";
import MarkdownRenderer from "./MarkdownRenderer";

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
const originalURL = window.location.href;

afterEach(() => {
  cleanup();
  happyDOM.setURL(originalURL);
});

test("a bare localhost URL links to the page's own host and says it is best-effort", () => {
  happyDOM.setURL("https://nick-mac-mini.tail361ef.ts.net/");

  const { container } = render(
    <MarkdownRenderer
      content={"dev server: http://localhost:5173/app?x=1#top\n\n[docs](https://example.com/docs)"}
    />,
  );
  const [rewritten, external] = Array.from(container.querySelectorAll("a"));

  expect(rewritten.getAttribute("href")).toBe(
    "http://nick-mac-mini.tail361ef.ts.net:5173/app?x=1#top",
  );
  expect(rewritten.textContent).toBe("http://localhost:5173/app?x=1#top");
  expect(rewritten.getAttribute("title")).toBe(LOOPBACK_LINK_NOTE);
  expect(rewritten.classList.contains("md-link--loopback")).toBe(true);
  expect(external.getAttribute("href")).toBe("https://example.com/docs");
  expect(external.hasAttribute("title")).toBe(false);
});
