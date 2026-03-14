import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseToolFn, SDKMessage, SDKSession } from "@anthropic-ai/claude-agent-sdk";

interface SessionInfo {
  session: SDKSession;
  cwd: string;
  status: "active" | "idle";
}

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  async createSession(
    sessionId: string,
    cwd: string,
    canUseTool: CanUseToolFn
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const session = await unstable_v2_createSession({
      model: "claude-sonnet-4-6",
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      includePartialMessages: true,
      permissionMode: "default",
      cwd,
      canUseTool,
    });

    this.sessions.set(sessionId, {
      session,
      cwd,
      status: "idle",
    });
  }

  async *sendMessage(
    sessionId: string,
    content: string
  ): AsyncGenerator<SDKMessage> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await sessionInfo.session.send(content);

    for await (const message of sessionInfo.session.stream()) {
      yield message;
    }
  }

  destroySession(sessionId: string): void {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      return; // no-op
    }

    sessionInfo.session.close();
    this.sessions.delete(sessionId);
  }
}
