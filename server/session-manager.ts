import type {
  AgentInfo,
  CanUseTool,
  Query,
  SDKMessage,
  SDKSystemMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode } from "./config";
import { loadUserPlugins } from "./settings-loader";

type SdkPluginConfig = { type: "local"; path: string };

interface SessionConfig {
  cwd: string;
  canUseTool: CanUseTool;
  sdkSessionId: string | null;
}

export interface Capabilities {
  commands: SlashCommand[];
  agents: AgentInfo[];
  model: string;
}

export class SessionManager {
  private sessions = new Map<string, SessionConfig>();
  private plugins: SdkPluginConfig[] | null = null;
  private activeQueries = new Map<string, Query>();
  private permissionMode: PermissionMode;
  private envVars: Record<string, string> = {};

  constructor(config: { permissionMode: PermissionMode }) {
    this.permissionMode = config.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  setEnvVars(envVars: Record<string, string>): void {
    this.envVars = envVars;
  }

  getEnvVars(): Record<string, string> {
    return this.envVars;
  }

  private async getPlugins(): Promise<SdkPluginConfig[]> {
    if (!this.plugins) {
      this.plugins = await loadUserPlugins();
    }
    return this.plugins;
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
      canUseTool,
      sdkSessionId: sdkSessionId ?? null,
    });
  }

  /** Update canUseTool callback for all sessions (e.g. after WS reconnect) */
  updateCanUseTool(canUseTool: CanUseTool): void {
    for (const config of this.sessions.values()) {
      config.canUseTool = canUseTool;
    }
  }

  async *sendMessage(sessionId: string, content: string): AsyncGenerator<SDKMessage> {
    const config = this.sessions.get(sessionId);
    if (!config) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const plugins = await this.getPlugins();
    const isBypass = this.permissionMode === "bypassPermissions";

    const q = query({
      prompt: content,
      options: {
        model: "claude-sonnet-4-6",
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        permissionMode: this.permissionMode,
        ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
        allowedTools: ["Skill"],
        plugins,
        cwd: config.cwd,
        env: { ...process.env, ...this.envVars },
        // Don't pass canUseTool in bypass mode — SDK auto-approves everything
        ...(!isBypass ? { canUseTool: config.canUseTool } : {}),
        ...(config.sdkSessionId ? { resume: config.sdkSessionId } : {}),
      },
    });

    this.activeQueries.set(sessionId, q);

    try {
      for await (const msg of q) {
        // Capture SDK session ID for future resume
        if (msg.type === "system" && msg.subtype === "init" && !config.sdkSessionId) {
          config.sdkSessionId = (msg as SDKSystemMessage).session_id;
        }

        yield msg;
      }
    } finally {
      this.activeQueries.delete(sessionId);
      q.close();
    }
  }

  async getCapabilities(sessionId: string): Promise<Capabilities | null> {
    const q = this.activeQueries.get(sessionId);
    if (!q) return null;

    try {
      const [commands, agents] = await Promise.all([q.supportedCommands(), q.supportedAgents()]);
      return {
        commands,
        agents,
        model: "claude-sonnet-4-6",
      };
    } catch {
      return null;
    }
  }

  destroySession(sessionId: string): void {
    const q = this.activeQueries.get(sessionId);
    if (q) {
      q.close();
      this.activeQueries.delete(sessionId);
    }
    this.sessions.delete(sessionId);
  }
}
