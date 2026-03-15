import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { listClaudeSessions } from "../session-listing";

interface ListSessionsOptions {
  dir?: string;
  limit?: number;
  offset?: number;
}

// Mock the SDK
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  listSessions: mock(async (options?: ListSessionsOptions) => {
    return mockListSessionsImpl(options);
  }),
}));

let mockListSessionsImpl: (options?: ListSessionsOptions) => Promise<SDKSessionInfo[]>;

describe("session-listing", () => {
  beforeEach(() => {
    // Reset mock implementation
    mockListSessionsImpl = async () => [];
  });

  test("T1: transforms SDKSessionInfo to SessionListItem", async () => {
    const mockSessions: SDKSessionInfo[] = [
      {
        sessionId: "session-1",
        summary: "auto summary",
        lastModified: 1000,
        customTitle: "My Custom Title",
        firstPrompt: "hello world",
        gitBranch: "main",
        cwd: "/test/path",
        createdAt: 500,
      },
      {
        sessionId: "session-2",
        summary: "another summary",
        lastModified: 2000,
        cwd: "/another/path",
      },
    ];

    mockListSessionsImpl = async () => mockSessions;

    const result = await listClaudeSessions();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      sdkSessionId: "session-1",
      displayTitle: "My Custom Title",
      cwd: "/test/path",
      gitBranch: "main",
      lastModified: 1000,
      createdAt: 500,
    });
    expect(result[1]).toEqual({
      sdkSessionId: "session-2",
      displayTitle: "another summary",
      cwd: "/another/path",
      gitBranch: undefined,
      lastModified: 2000,
      createdAt: undefined,
    });
  });

  test("T2: displayTitle priority: customTitle > firstPrompt > summary > Untitled", async () => {
    const testCases: Array<{
      input: Partial<SDKSessionInfo>;
      expected: string;
    }> = [
      {
        input: {
          customTitle: "Custom",
          firstPrompt: "First",
          summary: "Summary",
        },
        expected: "Custom",
      },
      {
        input: {
          firstPrompt: "First",
          summary: "Summary",
        },
        expected: "First",
      },
      {
        input: {
          summary: "Summary",
        },
        expected: "Summary",
      },
      {
        input: {},
        expected: "Untitled",
      },
    ];

    for (const testCase of testCases) {
      const mockSession: SDKSessionInfo = {
        sessionId: "test",
        summary: testCase.input.summary || "",
        lastModified: 1000,
        cwd: "/test",
        ...testCase.input,
      };

      mockListSessionsImpl = async () => [mockSession];

      const result = await listClaudeSessions();
      expect(result[0].displayTitle).toBe(testCase.expected);
    }
  });

  test("T3: empty result", async () => {
    mockListSessionsImpl = async () => [];

    const result = await listClaudeSessions();

    expect(result).toEqual([]);
  });

  test("passes options to SDK listSessions", async () => {
    let capturedOptions: ListSessionsOptions | undefined | null = null;
    mockListSessionsImpl = async (options?: ListSessionsOptions) => {
      capturedOptions = options;
      return [];
    };

    await listClaudeSessions({
      dir: "/custom/dir",
      limit: 10,
      offset: 5,
    });

    expect(capturedOptions).toEqual({
      dir: "/custom/dir",
      limit: 10,
      offset: 5,
    });
  });
});
