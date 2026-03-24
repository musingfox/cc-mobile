/**
 * Mock SessionManager that replays fixture event sequences
 * instead of calling the real Claude SDK.
 */

type CanUseTool = (
  toolName: string,
  input: unknown,
  options?: { toolUseID: string },
) => Promise<{ behavior: "allow" | "deny"; message?: string }>;

type FixtureMap = Record<string, unknown[]>;

interface PermissionMarker {
  _action: "request_permission";
  tool_name: string;
  tool_use_id: string;
  input: unknown;
}

export class MockSessionManager {
  private sessions = new Map<
    string,
    { cwd: string; sdkSessionId: string | null; canUseTool: CanUseTool | null }
  >();
  private fixtures: FixtureMap;
  private defaultFixture: string;
  private eventDelay: number;
  private globalCanUseTool: CanUseTool | null = null;

  constructor(options: {
    fixtures: FixtureMap;
    defaultFixture: string;
    eventDelay?: number;
  }) {
    this.fixtures = options.fixtures;
    this.defaultFixture = options.defaultFixture;
    this.eventDelay = options.eventDelay ?? 50;
  }

  async createSession(
    sessionId: string,
    cwd: string,
    canUseTool: CanUseTool,
    sdkSessionId?: string,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }
    this.sessions.set(sessionId, {
      cwd,
      sdkSessionId: sdkSessionId ?? null,
      canUseTool,
    });
    this.globalCanUseTool = canUseTool;
  }

  updateCanUseTool(canUseTool: CanUseTool): void {
    this.globalCanUseTool = canUseTool;
    // Update all existing sessions
    for (const session of this.sessions.values()) {
      session.canUseTool = canUseTool;
    }
  }

  async *sendMessage(sessionId: string, content: string): AsyncGenerator<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Select fixture based on message content keyword, or use default
    const fixtureName = this.resolveFixture(content);
    const events = this.fixtures[fixtureName];
    if (!events) {
      throw new Error(`Fixture "${fixtureName}" not found`);
    }

    for (const event of events) {
      // Check if this is a permission request marker
      if (this.isPermissionMarker(event)) {
        const canUseTool = session.canUseTool || this.globalCanUseTool;
        if (!canUseTool) {
          throw new Error("canUseTool not available for permission request");
        }

        // Call the real permission bridge
        const result = await canUseTool(event.tool_name, event.input, {
          toolUseID: event.tool_use_id,
        });

        // If denied, yield a text response explaining the denial, then result
        if (result.behavior === "deny") {
          // Yield text response
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 1,
              content_block: { type: "text", text: "" },
            },
            session_id: session.sdkSessionId || "mock-sdk-session-denied",
            parent_tool_use_id: null,
          };

          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 1,
              delta: {
                type: "text_delta",
                text:
                  result.message ||
                  `Permission was denied for ${event.tool_name}. I cannot proceed with this action.`,
              },
            },
            session_id: session.sdkSessionId || "mock-sdk-session-denied",
            parent_tool_use_id: null,
          };

          // Yield result with error
          yield {
            type: "result",
            subtype: "error",
            is_error: true,
            result: result.message || `${event.tool_name} was denied by user.`,
            session_id: session.sdkSessionId || "mock-sdk-session-denied",
          };
          return;
        }

        // If allowed, continue to next events
        continue;
      }

      // Small delay between events to simulate real streaming
      await new Promise((r) => setTimeout(r, this.eventDelay));
      yield event;
    }
  }

  private isPermissionMarker(event: unknown): event is PermissionMarker {
    return (
      typeof event === "object" &&
      event !== null &&
      "_action" in event &&
      event._action === "request_permission"
    );
  }

  async getCapabilities(_sessionId: string) {
    return null;
  }

  async getInitData(_sessionId: string) {
    return null;
  }

  getPermissionMode(): string {
    return "default";
  }

  getSelectedModel(): string {
    return "claude-sonnet-4-6";
  }

  getSelectedEffort(): string | null {
    return null;
  }

  setPermissionMode(_mode: string): void {}

  setEnvVars(_envVars: Record<string, string>): void {}

  async setModel(_model: string, _sessionId?: string): Promise<void> {}

  setEffort(_effort: string | null): void {}

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private resolveFixture(content: string): string {
    const lower = content.toLowerCase();
    for (const name of Object.keys(this.fixtures)) {
      if (lower.includes(name)) return name;
    }
    return this.defaultFixture;
  }
}
