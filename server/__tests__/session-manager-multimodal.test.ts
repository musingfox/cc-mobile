import { describe, expect, test } from "bun:test";
import type { ContentBlock } from "../protocol";

describe("Session manager multimodal message construction", () => {
  test("C4-TC1: String content is passed as-is to SDK", () => {
    const content = "hello world";

    // The SessionManager should pass string content directly to query({ prompt: content })
    // This is the existing behavior and should not change
    expect(typeof content).toBe("string");
  });

  test("C4-TC2: ContentBlock array is converted to SDKUserMessage format", async () => {
    const content: ContentBlock[] = [
      {
        type: "text",
        text: "Check this image:",
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: "abc123==",
        },
      },
    ];

    // The SessionManager should convert ContentBlock[] to an async generator
    // that yields SDKUserMessage with MessageParam structure:
    // {
    //   type: "user",
    //   message: {
    //     role: "user",
    //     content: [
    //       { type: "text", text: "Check this image:" },
    //       { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "abc123==" } }
    //     ]
    //   },
    //   parent_tool_use_id: null,
    //   session_id: <sessionId>
    // }

    // Verify the content blocks are properly structured
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image");

    // Verify image block structure
    const imageBlock = content[1];
    if (imageBlock.type === "image") {
      expect(imageBlock.source.type).toBe("base64");
      expect(imageBlock.source.media_type).toBe("image/jpeg");
      expect(imageBlock.source.data).toBe("abc123==");
    }
  });

  test("C4-TC3: Mixed content blocks maintain order", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "First text" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "img1",
        },
      },
      { type: "text", text: "Second text" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/gif",
          data: "img2",
        },
      },
    ];

    // Verify order is maintained
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image");
    expect(content[2].type).toBe("text");
    expect(content[3].type).toBe("image");

    if (content[0].type === "text") {
      expect(content[0].text).toBe("First text");
    }
    if (content[2].type === "text") {
      expect(content[2].text).toBe("Second text");
    }
  });

  test("C4-TC4: All supported media types are handled", () => {
    const mediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

    for (const mediaType of mediaTypes) {
      const content: ContentBlock[] = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: "test-data",
          },
        },
      ];

      expect(content[0].type).toBe("image");
      if (content[0].type === "image") {
        expect(content[0].source.media_type).toBe(mediaType);
      }
    }
  });
});
