/**
 * Mock SessionManager that replays fixture event sequences
 * instead of calling the real Claude SDK.
 */

type CanUseTool = (toolName: string, input: unknown) => Promise<boolean>;

type FixtureMap = Record<string, unknown[]>;

export class MockSessionManager {
  private sessions = new Map<string, { cwd: string; sdkSessionId: string | null }>();
  private fixtures: FixtureMap;
  private defaultFixture: string;
  private eventDelay: number;

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
    _canUseTool: CanUseTool,
    sdkSessionId?: string,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }
    this.sessions.set(sessionId, { cwd, sdkSessionId: sdkSessionId ?? null });
  }

  async *sendMessage(
    sessionId: string,
    content: string,
  ): AsyncGenerator<unknown> {
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
      // Small delay between events to simulate real streaming
      await new Promise((r) => setTimeout(r, this.eventDelay));
      yield event;
    }
  }

  async getCapabilities(_sessionId: string) {
    return null;
  }

  getPermissionMode(): "default" | "trusted" | "paranoid" {
    return "default";
  }

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
