import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { uploadImage } from "../upload-service";

/**
 * `uploadImage` mirrors `uploadFile`: posts JSON {sessionId, base64, mediaType}
 * to {basePath}/api/upload-image and returns {path, sizeKB}.
 * Deterministic gate: assert the request shape via a fake fetch.
 */

const realFetch = globalThis.fetch;

describe("uploadImage service (mirror of uploadFile)", () => {
  beforeEach(() => {
    (globalThis as { __BASE_PATH__?: string }).__BASE_PATH__ = "";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("posts JSON body to /api/upload-image and returns {path, sizeKB}", async () => {
    let captured: { url: string; body: unknown } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ path: "/c/x.png", sizeKB: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const out = await uploadImage("s1", "AAAA", "image/png");

    expect(captured).not.toBeNull();
    expect((captured as { url: string }).url).toContain("/api/upload-image");
    expect((captured as { body: unknown }).body).toEqual({
      sessionId: "s1",
      base64: "AAAA",
      mediaType: "image/png",
    });
    expect(out).toEqual({ path: "/c/x.png", sizeKB: 2 });
  });
});
