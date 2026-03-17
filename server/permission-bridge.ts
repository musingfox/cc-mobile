import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

interface ToolUse {
  name: string;
  parameters: Record<string, unknown>;
}

type SendToClientFn = (requestId: string, tool: ToolUse) => void;

interface PermissionHandlerOptions {
  timeoutMs?: number;
}

export function createPermissionHandler(
  sendToClient: SendToClientFn,
  options: PermissionHandlerOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 60000;
  const pendingRequests = new Map<
    string,
    {
      resolve: (result: PermissionResult) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const requestId = options.toolUseID;
    console.log(`[permission] request: ${toolName} id=${requestId}`);

    return new Promise<PermissionResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        console.log(`[permission] TIMEOUT: ${requestId}`);
        pendingRequests.delete(requestId);
        resolve({
          behavior: "deny",
          message: "Permission timeout — session interrupted",
          toolUseID: options.toolUseID,
        });
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, timeoutId });

      sendToClient(requestId, {
        name: toolName,
        parameters: input,
      });
    });
  };

  const resolvePermission = (requestId: string, allow: boolean): void => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      console.warn(
        `[permission] UNKNOWN requestId: ${requestId} (pending: ${[...pendingRequests.keys()].join(", ")})`,
      );
      return;
    }

    clearTimeout(pending.timeoutId);
    pendingRequests.delete(requestId);

    pending.resolve(
      allow
        ? { behavior: "allow", updatedInput: undefined, toolUseID: requestId }
        : { behavior: "deny", message: "Denied by user", toolUseID: requestId },
    );
  };

  return {
    canUseTool,
    resolvePermission,
  };
}
