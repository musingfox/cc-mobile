import { describe, expect, test } from "bun:test";
import { rewriteLoopbackHref } from "./loopback-url";

const TAILNET = "nick-mac-mini.tail361ef.ts.net";

describe("rewriteLoopbackHref", () => {
  test.each([
    ["http://localhost:5173/a?b=1#c", `http://${TAILNET}:5173/a?b=1#c`],
    ["http://127.0.0.1:3000", `http://${TAILNET}:3000/`],
    ["http://0.0.0.0:8080/x", `http://${TAILNET}:8080/x`],
    ["http://[::]:3000/y?z#w", `http://${TAILNET}:3000/y?z#w`],
    ["http://[::1]:5173/", `http://${TAILNET}:5173/`],
  ])("moves %s onto the page's host, keeping port, path, query and fragment", (href, expected) => {
    expect(rewriteLoopbackHref(href, TAILNET)).toBe(expected);
  });

  test("reads an IPv6 literal whose brackets marked percent-encoded", () => {
    expect(rewriteLoopbackHref("http://%5B::%5D:3000/y", TAILNET)).toBe(`http://${TAILNET}:3000/y`);
  });

  test("keeps the link's own scheme", () => {
    expect(rewriteLoopbackHref("https://localhost:8443/", TAILNET)).toBe(
      `https://${TAILNET}:8443/`,
    );
    expect(rewriteLoopbackHref("http://localhost:5173/", TAILNET)).toBe(`http://${TAILNET}:5173/`);
  });

  test("matches the host case-insensitively", () => {
    expect(rewriteLoopbackHref("http://LOCALHOST:5173/", TAILNET)).toBe(`http://${TAILNET}:5173/`);
  });

  test.each([
    "https://example.com/x",
    "http://localhost.example.com/",
    "http://192.168.1.2:3000/",
    "http://127.0.0.2:3000/",
    "/relative/path",
    "#fragment",
    "mailto:someone@localhost",
    "file://localhost/etc/hosts",
    "ws://localhost:3001/ws",
    "not a url",
  ])("leaves %s alone", (href) => {
    expect(rewriteLoopbackHref(href, TAILNET)).toBeNull();
  });

  test.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0",
    "[::]",
    "",
  ])("rewrites nothing when the page itself is served from %p", (pageHostname) => {
    expect(rewriteLoopbackHref("http://localhost:5173/", pageHostname)).toBeNull();
  });

  test("follows whatever non-loopback host the page was reached by", () => {
    expect(rewriteLoopbackHref("http://localhost:3000/", "192.168.1.20")).toBe(
      "http://192.168.1.20:3000/",
    );
    expect(rewriteLoopbackHref("http://localhost:3000/", "[fd7a:115c::1]")).toBe(
      "http://[fd7a:115c::1]:3000/",
    );
  });
});
