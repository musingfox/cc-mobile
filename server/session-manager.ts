import type {
  AccountInfo,
  AgentInfo,
  CanUseTool,
  ModelInfo,
  Query,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode } from "./config";
import type { ContentBlock } from "./protocol";
import { loadUserPlugins } from "./settings-loader";
import { truncateToolResponse } from "./tool-output-truncator";
import { cleanupUploads } from "./upload-manager";

type SdkPluginConfig = { type: "local"; path: string };

interface SessionConfig {
  cwd: string;
  canUseTool: CanUseTool;
  sdkSessionId: string | null;
  permissionMode?: PermissionMode;
}

export interface Capabilities {
  commands: SlashCommand[];
  agents: AgentInfo[];
  model: string;
}

export interface InitData {
  models: ModelInfo[];
  account: AccountInfo;
}

export class SessionManager {
  private sessions = new Map<string, SessionConfig>();
  private plugins: SdkPluginConfig[] | null = null;
  private activeQueries = new Map<string, Query>();
  private permissionMode: PermissionMode;
  private envVars: Record<string, string> = {};
  /** Empty string means "follow the CLI / SDK default model" (no override). */
  private selectedModel = "";
  private selectedEffort: "low" | "medium" | "high" | "max" | null = null;

  constructor(config: { permissionMode: PermissionMode }) {
    this.permissionMode = config.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
    const config = this.sessions.get(sessionId);
    if (!config) {
      throw new Error(`Session ${sessionId} not found`);
    }

    config.permissionMode = mode;

    const q = this.activeQueries.get(sessionId);
    if (q) {
      q.setPermissionMode(mode).catch((err) =>
        console.warn("[session-manager] mid-turn setPermissionMode failed:", err),
      );
    }
  }

  getSessionPermissionMode(sessionId: string): PermissionMode | undefined {
    return this.sessions.get(sessionId)?.permissionMode;
  }

  setEnvVars(envVars: Record<string, string>): void {
    this.envVars = envVars;
  }

  getEnvVars(): Record<string, string> {
    return this.envVars;
  }

  getSelectedModel(): string {
    return this.selectedModel;
  }

  /** Set model for next query. If a query is active, also switch mid-turn. */
  async setModel(model: string, sessionId?: string): Promise<void> {
    this.selectedModel = model;
    if (sessionId) {
      const q = this.activeQueries.get(sessionId);
      if (q) {
        try {
          await q.setModel(model);
        } catch (err) {
          console.warn("[session-manager] mid-turn setModel failed:", err);
        }
      }
    }
  }

  getSelectedEffort(): "low" | "medium" | "high" | "max" | null {
    return this.selectedEffort;
  }

  setEffort(effort: "low" | "medium" | "high" | "max" | null): void {
    this.selectedEffort = effort;
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
      permissionMode: undefined,
    });
  }

  /** Update canUseTool callback for all sessions (e.g. after WS reconnect) */
  updateCanUseTool(canUseTool: CanUseTool): void {
    for (const config of this.sessions.values()) {
      config.canUseTool = canUseTool;
    }
  }

  async *sendMessage(
    sessionId: string,
    content: string | ContentBlock[],
  ): AsyncGenerator<SDKMessage> {
    const config = this.sessions.get(sessionId);
    if (!config) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const plugins = await this.getPlugins();
    const effectivePermissionMode = config.permissionMode ?? this.permissionMode;
    const isBypass = effectivePermissionMode === "bypassPermissions";

    // Handle both string and content block array formats
    // When content is string: pass as simple string prompt (SDK converts to MessageParam internally)
    // When content is ContentBlock[]: use async generator to pass SDKUserMessage with MessageParam
    const promptValue: string | AsyncIterable<SDKUserMessage> =
      typeof content === "string"
        ? content
        : (async function* (): AsyncGenerator<SDKUserMessage> {
            yield {
              type: "user" as const,
              message: {
                role: "user" as const,
                content: content.map((block) => {
                  if (block.type === "text") {
                    return { type: "text" as const, text: block.text };
                  }
                  // image block
                  return {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: block.source.media_type,
                      data: block.source.data,
                    },
                  };
                }),
              },
              parent_tool_use_id: null,
              session_id: config.sdkSessionId || sessionId, // Use SDK session_id if available, fallback to WS session_id
            };
          })();

    const q = query({
      prompt: promptValue,
      options: {
        ...(this.selectedModel ? { model: this.selectedModel } : {}),
        ...(this.selectedEffort ? { effort: this.selectedEffort } : {}),
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        promptSuggestions: true,
        agentProgressSummaries: true,
        permissionMode: effectivePermissionMode,
        ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
        skills: "all",
        toolConfig: { askUserQuestion: { previewFormat: "markdown" } },
        hooks: {
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== "PostToolUse") return {};
                  const replacement = truncateToolResponse(input.tool_response);
                  if (replacement === null) return {};
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PostToolUse",
                      updatedToolOutput: replacement,
                    },
                  };
                },
              ],
            },
          ],
        },
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
          const sessionId = (msg as SDKSystemMessage).session_id;
          if (sessionId !== undefined) {
            config.sdkSessionId = sessionId;
          }
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
      const toCommand = (c: unknown): SlashCommand => {
        if (typeof c === "string") return { name: c, description: "", argumentHint: "" };
        const obj = c as { name?: unknown; description?: unknown; argumentHint?: unknown };
        return {
          name: typeof obj.name === "string" ? obj.name : String(obj.name ?? ""),
          description: typeof obj.description === "string" ? obj.description : "",
          argumentHint: typeof obj.argumentHint === "string" ? obj.argumentHint : "",
        };
      };
      const toAgent = (a: unknown): AgentInfo => {
        if (typeof a === "string") return { name: a, description: "" };
        const obj = a as { name?: unknown; description?: unknown; model?: unknown };
        return {
          name: typeof obj.name === "string" ? obj.name : String(obj.name ?? ""),
          description: typeof obj.description === "string" ? obj.description : "",
          ...(typeof obj.model === "string" ? { model: obj.model } : {}),
        };
      };
      return {
        commands: commands.map(toCommand),
        agents: agents.map(toAgent),
        model: this.selectedModel,
      };
    } catch {
      return null;
    }
  }

  /** Fetch models + account info from SDK initializationResult() */
  async getInitData(sessionId: string): Promise<InitData | null> {
    const q = this.activeQueries.get(sessionId);
    if (!q) return null;

    try {
      const result = await q.initializationResult();
      return {
        models: result.models,
        account: result.account,
      };
    } catch (err) {
      console.warn("[session-manager] getInitData failed:", err);
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

    // Cleanup uploaded files for this session
    cleanupUploads(sessionId).catch((err) => {
      console.warn(`[session-manager] cleanup failed for session ${sessionId}:`, err);
    });
  }
}
