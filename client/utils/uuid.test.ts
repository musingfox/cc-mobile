import { afterEach, describe, expect, test } from "bun:test";
import { WORKSPACE_LABEL_PATTERN } from "../../server/herdr/registry";
import { randomUuid } from "./uuid";

/**
 * The check is the server's own regex rather than a hand-written uuid shape:
 * this string becomes a herdr workspace label, and that pattern is what decides
 * later whether cc-mobile still owns the pane. Anything it rejects is a session
 * the phone can create and then never close.
 */
function isServerAcceptable(uuid: string): boolean {
  return WORKSPACE_LABEL_PATTERN.test(`ccm-${uuid}`);
}

/** Runs `body` with `crypto.randomUUID` gone, the way an http origin sees it. */
function withoutRandomUUID(body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    body();
  } finally {
    if (original) Object.defineProperty(crypto, "randomUUID", original);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
}

describe("randomUuid", () => {
  afterEach(() => {
    expect(typeof crypto.randomUUID).toBe("function");
  });

  test("uses the platform's uuid on a secure origin", () => {
    expect(isServerAcceptable(randomUuid())).toBe(true);
  });

  test("still answers on an insecure origin, in a shape the server owns", () => {
    withoutRandomUUID(() => {
      const uuid = randomUuid();
      expect(isServerAcceptable(uuid)).toBe(true);
      // v4 and the RFC 4122 variant, the two fields the pattern does not pin.
      expect(uuid[14]).toBe("4");
      expect("89ab").toContain(uuid[19] ?? "");
    });
  });

  test("does not repeat itself on the fallback path", () => {
    withoutRandomUUID(() => {
      const seen = new Set(Array.from({ length: 500 }, () => randomUuid()));
      expect(seen.size).toBe(500);
    });
  });
});
