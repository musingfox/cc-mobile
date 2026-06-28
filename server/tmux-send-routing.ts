import { createPtyResponseRelay } from "./pty-response-relay";

export type RunCommand = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => Promise<RunResult>;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface TmuxSendRoutingOptions {
  runCommand?: RunCommand;
  responseRelay?: ReturnType<typeof createPtyResponseRelay>;
}

export interface TmuxSendParams {
  claudeUuid: string;
  content: string;
}

function defaultRunCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd,
    env: opts.env ?? (process.env as any),
    stdout: "pipe",
    stderr: "pipe",
  });
  return (async () => {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, stdout, stderr };
  })();
}

/**
 * C2-Concat: flatten multi-line prompt for tmux send-keys.
 * Newlines (any of \r\n | \r | \n) -> single space; NO trim.
 */
export function flattenPrompt(input: string): string {
  if (typeof input !== "string") return "";
  return input.replace(/\r\n|\r|\n/g, " ");
}

export function createTmuxSendRouting(options: TmuxSendRoutingOptions = {}) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const relay = options.responseRelay ?? createPtyResponseRelay();

  const clientSinks = new Map<string, (msg: Record<string, unknown>) => void>();
  // owner (e.g. ws connection) -> set of uuids it registered. Used to clean dead bindings on ws close.
  const ownerToUuids = new Map<unknown, Set<string>>();
  // uuid -> its current owner, so re-registration can move the binding correctly.
  const uuidToOwner = new Map<string, unknown>();

  function registerClient(
    claudeUuid: string,
    sink: (msg: Record<string, unknown>) => void,
    owner?: unknown,
  ) {
    clientSinks.set(claudeUuid, sink);
    // Re-registration: detach from previous owner before attaching to the new one.
    const prevOwner = uuidToOwner.get(claudeUuid);
    if (prevOwner !== undefined && prevOwner !== owner) {
      ownerToUuids.get(prevOwner)?.delete(claudeUuid);
    }
    if (owner !== undefined) {
      uuidToOwner.set(claudeUuid, owner);
      let set = ownerToUuids.get(owner);
      if (!set) {
        set = new Set();
        ownerToUuids.set(owner, set);
      }
      set.add(claudeUuid);
    } else {
      uuidToOwner.delete(claudeUuid);
    }
  }

  async function send(params: TmuxSendParams): Promise<void> {
    const { claudeUuid, content } = params;
    const sink = clientSinks.get(claudeUuid);
    if (!sink) {
      // T3: not registered -> no runCommand, no pending
      return;
    }

    const flattened = flattenPrompt(content);

    // Arm waiter first (makes hasPending true)
    const responsePromise = relay.awaitResponse(claudeUuid);

    // Exactly one send-keys; arg has no embedded newline (per C2-Concat)
    await runCommand("tmux", ["send-keys", "-t", `ccm-${claudeUuid}`, flattened, "Enter"]);

    // When resolved by Stop POST via relay, deliver to THIS client's sink only.
    // Chunk shape aligned to pty-orchestrator.ts:164-179 (assistant + stream_end)
    responsePromise
      .then((text: string) => {
        const currentSink = clientSinks.get(claudeUuid);
        if (currentSink) {
          currentSink({
            type: "stream_chunk",
            sessionId: claudeUuid,
            chunk: {
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "text", text }],
                stop_reason: "end_turn",
              },
            },
          });
          currentSink({
            type: "stream_end",
            sessionId: claudeUuid,
          });
        }
      })
      .catch(() => {
        // cancelled/timeout/superseded: no delivery
      });
  }

  function hasPending(claudeUuid: string): boolean {
    return relay.hasPending(claudeUuid);
  }

  function teardown(claudeUuid: string): void {
    clientSinks.delete(claudeUuid);
    const cancelFn = (relay as any).cancel;
    if (typeof cancelFn === "function") {
      cancelFn(claudeUuid);
    }
    const owner = uuidToOwner.get(claudeUuid);
    if (owner !== undefined) {
      ownerToUuids.get(owner)?.delete(claudeUuid);
      uuidToOwner.delete(claudeUuid);
    }
  }

  // Clean every dead uuid->sink binding owned by a given connection (ws close).
  // Same per-uuid cleanup as teardown; does NOT rebind/replay to any new connection.
  function cleanupByOwner(owner: unknown): void {
    const uuids = ownerToUuids.get(owner);
    if (!uuids) return;
    for (const claudeUuid of uuids) {
      clientSinks.delete(claudeUuid);
      const cancelFn = (relay as any).cancel;
      if (typeof cancelFn === "function") {
        cancelFn(claudeUuid);
      }
      uuidToOwner.delete(claudeUuid);
    }
    ownerToUuids.delete(owner);
  }

  function getClient(claudeUuid: string) {
    return clientSinks.get(claudeUuid);
  }

  return {
    registerClient,
    send,
    hasPending,
    teardown,
    cleanupByOwner,
    getClient,
    _clientSinks: clientSinks,
  };
}
