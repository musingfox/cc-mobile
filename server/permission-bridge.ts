import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

interface ToolUse {
  name: string;
  parameters: Record<string, unknown>;
}

type SendToClientFn = (requestId: string, tool: ToolUse) => void;

interface PermissionHandlerOptions {
  timeoutMs?: number;
}

export interface PendingPermissionSnapshot {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  elapsedMs: number;
  sessionId: string;
}

export function createPermissionHandler(
  sendToClient: SendToClientFn,
  options: PermissionHandlerOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 60000;
  // eslint-disable-next-line prefer-const
  let currentSendToClient = sendToClient;

  const pendingRequests = new Map<
    string,
    {
      resolve: (result: PermissionResult) => void;
      timeoutId: ReturnType<typeof setTimeout> | null;
      input: Record<string, unknown>;
      toolName: string;
      createdAt: number;
      sessionId: string;
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

      pendingRequests.set(requestId, {
        resolve,
        timeoutId,
        input,
        toolName,
        createdAt: Date.now(),
        sessionId: (options as any).sessionId || "",
      });

      currentSendToClient(requestId, {
        name: toolName,
        parameters: input,
      });
    });
  };

  const resolvePermission = (
    requestId: string,
    allow: boolean,
    answers?: Record<string, string>,
  ): void => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      console.warn(
        `[permission] UNKNOWN requestId: ${requestId} (pending: ${Array.from(pendingRequests.keys()).join(", ")})`,
      );
      return;
    }

    if (pending.timeoutId !== null) {
      clearTimeout(pending.timeoutId);
    }
    pendingRequests.delete(requestId);

    if (!allow) {
      pending.resolve({
        behavior: "deny",
        message: "Denied by user",
        toolUseID: requestId,
      });
      return;
    }

    if (answers && Object.keys(answers).length > 0) {
      pending.resolve({
        behavior: "allow",
        updatedInput: {
          ...pending.input,
          answers,
        },
        toolUseID: requestId,
      });
    } else {
      pending.resolve({
        behavior: "allow",
        updatedInput: undefined,
        toolUseID: requestId,
      });
    }
  };

  const pausePending = (): PendingPermissionSnapshot[] => {
    const snapshots: PendingPermissionSnapshot[] = [];
    const now = Date.now();

    for (const [requestId, pending] of Array.from(pendingRequests.entries())) {
      snapshots.push({
        requestId,
        toolName: pending.toolName,
        input: pending.input,
        elapsedMs: now - pending.createdAt,
        sessionId: pending.sessionId,
      });

      // Clear timeout but keep the pending promise
      if (pending.timeoutId !== null) {
        clearTimeout(pending.timeoutId);
        pending.timeoutId = null;
      }
    }

    console.log(`[permission] paused ${snapshots.length} pending permissions`);
    return snapshots;
  };

  const resumePending = (snapshots: PendingPermissionSnapshot[]): void => {
    console.log(`[permission] resuming ${snapshots.length} permissions`);

    for (const snapshot of snapshots) {
      const pending = pendingRequests.get(snapshot.requestId);
      if (!pending) {
        console.warn(`[permission] resume: requestId ${snapshot.requestId} not found`);
        continue;
      }

      const remainingMs = timeoutMs - snapshot.elapsedMs;

      if (remainingMs <= 0) {
        // Timeout expired during disconnect
        console.log(`[permission] resume: ${snapshot.requestId} expired, denying`);
        pendingRequests.delete(snapshot.requestId);
        pending.resolve({
          behavior: "deny",
          message: "Permission timeout — session interrupted",
          toolUseID: snapshot.requestId,
        });
        continue;
      }

      // Restart timeout with remaining time
      const timeoutId = setTimeout(() => {
        console.log(`[permission] TIMEOUT (resumed): ${snapshot.requestId}`);
        pendingRequests.delete(snapshot.requestId);
        pending.resolve({
          behavior: "deny",
          message: "Permission timeout — session interrupted",
          toolUseID: snapshot.requestId,
        });
      }, remainingMs);

      pending.timeoutId = timeoutId;

      // Re-send permission_request to client
      currentSendToClient(snapshot.requestId, {
        name: snapshot.toolName,
        parameters: snapshot.input,
      });
    }
  };

  const updateSendToClient = (newSendToClient: SendToClientFn): void => {
    currentSendToClient = newSendToClient;
    console.log("[permission] updated sendToClient callback");
  };

  return {
    canUseTool,
    resolvePermission,
    pausePending,
    resumePending,
    updateSendToClient,
  };
}
