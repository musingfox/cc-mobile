import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { SessionListItemSchema } from "../protocol";
import { listClaudeSessions, renameClaudeSession } from "../session-listing";

interface ListSessionsOptions {
  dir?: string;
  limit?: number;
  offset?: number;
}

interface RenameCall {
  sessionId: string;
  title: string;
  options: { dir?: string } | undefined;
}

// Mock the SDK
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  listSessions: mock(async (options?: ListSessionsOptions) => {
    return mockListSessionsImpl(options);
  }),
  renameSession: mock(async (sessionId: string, title: string, options?: { dir?: string }) => {
    renameCalls.push({ sessionId, title, options });
    return mockRenameSessionImpl(sessionId, title, options);
  }),
}));

let mockListSessionsImpl: (options?: ListSessionsOptions) => Promise<SDKSessionInfo[]>;
let mockRenameSessionImpl: (
  sessionId: string,
  title: string,
  options?: { dir?: string },
) => Promise<void>;
const renameCalls: RenameCall[] = [];

describe("session-listing", () => {
  beforeEach(() => {
    // Reset mock implementation
    mockListSessionsImpl = async () => [];
    mockRenameSessionImpl = async () => {};
    renameCalls.length = 0;
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
      customTitle: "My Custom Title",
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

  test("transformSessionInfo propagates customTitle when present", async () => {
    mockListSessionsImpl = async () => [
      {
        sessionId: "session-1",
        summary: "auto",
        lastModified: 1000,
        customTitle: "Friendly Title",
        cwd: "/p",
      } as SDKSessionInfo,
    ];

    const [item] = await listClaudeSessions();
    expect(item.customTitle).toBe("Friendly Title");
  });

  test("transformSessionInfo omits customTitle field when absent", async () => {
    mockListSessionsImpl = async () => [
      {
        sessionId: "session-2",
        summary: "auto",
        lastModified: 1000,
        cwd: "/p",
      } as SDKSessionInfo,
    ];

    const [item] = await listClaudeSessions();
    expect("customTitle" in item).toBe(false);
  });

  test("renameClaudeSession passes { dir } when dir provided", async () => {
    await renameClaudeSession("uuid-1", "My title", "/some/dir");
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0]).toEqual({
      sessionId: "uuid-1",
      title: "My title",
      options: { dir: "/some/dir" },
    });
  });

  test("renameClaudeSession passes undefined options when dir omitted", async () => {
    await renameClaudeSession("uuid-2", "Other title");
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0]).toEqual({
      sessionId: "uuid-2",
      title: "Other title",
      options: undefined,
    });
  });

  test("renameClaudeSession propagates SDK errors", async () => {
    mockRenameSessionImpl = async () => {
      throw new Error("disk write failed");
    };
    await expect(renameClaudeSession("uuid-3", "x")).rejects.toThrow("disk write failed");
  });

  test("SessionListItemSchema accepts items without customTitle", () => {
    const ok = SessionListItemSchema.safeParse({
      sdkSessionId: "u",
      displayTitle: "t",
      cwd: "/p",
      lastModified: 1,
    });
    expect(ok.success).toBe(true);
  });

  test("SessionListItemSchema accepts items with customTitle", () => {
    const ok = SessionListItemSchema.safeParse({
      sdkSessionId: "u",
      displayTitle: "t",
      cwd: "/p",
      lastModified: 1,
      customTitle: "Renamed",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.customTitle).toBe("Renamed");
    }
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
