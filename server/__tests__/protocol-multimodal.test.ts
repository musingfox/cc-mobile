import { describe, expect, test } from "bun:test";
import { ClientMessage } from "../protocol";

describe("ContentBlock schemas", () => {
  test("TC1: Valid string content passes", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: "hello world",
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC2: Valid text block passes", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: [
        {
          type: "text",
          text: "hello world",
        },
      ],
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC3: Valid image block passes", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "abc123==",
          },
        },
      ],
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC4: Mixed text and image blocks pass", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: [
        {
          type: "text",
          text: "Check this image:",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgo=",
          },
        },
      ],
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC5: Invalid media type fails", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/bmp", // Not in enum
            data: "abc",
          },
        },
      ],
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("TC6: Missing required field in image block fails", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            // missing data
          },
        },
      ],
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("TC7: Invalid block type fails", () => {
    const input = {
      type: "send",
      sessionId: "sess-123",
      content: [
        {
          type: "video", // Not a valid type
          url: "https://example.com/video.mp4",
        },
      ],
    };
    const result = ClientMessage.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("TC8: All supported media types pass", () => {
    const mediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    for (const mediaType of mediaTypes) {
      const input = {
        type: "send",
        sessionId: "sess-123",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: "abc",
            },
          },
        ],
      };
      const result = ClientMessage.safeParse(input);
      expect(result.success).toBe(true);
    }
  });
});
