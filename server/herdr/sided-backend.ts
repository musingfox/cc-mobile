/**
 * sided-backend.ts — one backend face over the cockpit daemon and the optional
 * hangar daemon (ADR-018). Hangar panes are keyed `<name>@<pane_id>` on the
 * wire; each inner backend only ever sees its own bare pane ids.
 */

import type {
  ClientSink,
  CreateSessionInput,
  TeardownResult,
  TerminalHasSessionResult,
  TerminalSendParams,
  TerminalSessionInfo,
} from "../terminal-backend";
import type { AgentState } from "./agent-state";
import type { HerdrTerminalBackend } from "./backend";
import type { SessionDescriptor } from "./sessions";
import { hangarKey, routeSessionKey, type Side } from "./sides";
import type { SocketWatch } from "./socket-watch";

export interface HerdrStatus {
  cockpit: { online: boolean };
  hangar?: { name: string; online: boolean };
}

export type SidedSessionDescriptor = SessionDescriptor & { side: Side };

export interface SidedBackendOptions {
  cockpit: { backend: HerdrTerminalBackend; watch?: SocketWatch };
  hangar?: { name: string; backend: HerdrTerminalBackend; watch?: SocketWatch };
  warn?: (message: string) => void;
}

export function createSidedBackend(options: SidedBackendOptions) {
  const { cockpit, hangar } = options;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const hangarName = hangar?.name ?? null;

  function route(key: string): { backend: HerdrTerminalBackend; paneId: string; side: Side } {
    const { side, paneId } = routeSessionKey(key, hangarName);
    const backend = side === "hangar" && hangar ? hangar.backend : cockpit.backend;
    return { backend, paneId, side };
  }

  function prefix(paneId: string): string {
    return hangar ? hangarKey(hangar.name, paneId) : paneId;
  }

  function wrapSink(sink: ClientSink, paneId: string): ClientSink {
    const key = prefix(paneId);
    return (frame) => sink(frame.sessionId === paneId ? { ...frame, sessionId: key } : frame);
  }

  const warnedIncompatible: Record<Side, boolean> = { cockpit: false, hangar: false };

  async function listSide(
    side: Side,
    name: string | null,
    backend: HerdrTerminalBackend,
    watch: SocketWatch | undefined,
  ): Promise<{ online: boolean; sessions: SessionDescriptor[] }> {
    if (watch?.status() === "incompatible") {
      if (!warnedIncompatible[side]) {
        warnedIncompatible[side] = true;
        warn(`[herdr] ${name ?? side} socket speaks an incompatible protocol`);
      }
      return { online: false, sessions: [] };
    }
    warnedIncompatible[side] = false;
    try {
      const outcome = await backend.listSessionsOutcome();
      return outcome.ok
        ? { online: true, sessions: outcome.sessions }
        : { online: false, sessions: [] };
    } catch {
      return { online: false, sessions: [] };
    }
  }

  function holder(requestId: string): { backend: HerdrTerminalBackend; side: Side } | undefined {
    if (cockpit.backend.paneIdForRequest(requestId) !== undefined) {
      return { backend: cockpit.backend, side: "cockpit" };
    }
    if (hangar && hangar.backend.paneIdForRequest(requestId) !== undefined) {
      return { backend: hangar.backend, side: "hangar" };
    }
    return undefined;
  }

  let started = false;

  const watches = [cockpit.watch, hangar?.watch].filter((w): w is SocketWatch => w !== undefined);

  return {
    start(): void {
      if (started) return;
      started = true;
      if (hangar) {
        new Promise<void>((resolve) => resolve(hangar.backend.start())).catch((error: unknown) =>
          warn(
            `[herdr] ${hangar.name} start: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      for (const watch of watches) watch.start();
    },

    async listSessions(): Promise<{
      sessions: SidedSessionDescriptor[];
      herdr: HerdrStatus;
    }> {
      const [c, h] = await Promise.all([
        listSide("cockpit", null, cockpit.backend, cockpit.watch),
        hangar ? listSide("hangar", hangar.name, hangar.backend, hangar.watch) : undefined,
      ]);
      const sessions: SidedSessionDescriptor[] = c.sessions.map((s) => ({
        ...s,
        side: "cockpit" as const,
      }));
      const herdr: HerdrStatus = { cockpit: { online: c.online } };
      if (hangar && h) {
        for (const s of h.sessions) {
          sessions.push({ ...s, sessionId: hangarKey(hangar.name, s.sessionId), side: "hangar" });
        }
        herdr.hangar = { name: hangar.name, online: h.online };
      }
      return { sessions, herdr };
    },

    async listStates(): Promise<Record<string, AgentState>> {
      const [c, h] = await Promise.all([
        cockpit.backend.listStates(),
        hangar ? hangar.backend.listStates() : Promise.resolve({} as Record<string, AgentState>),
      ]);
      const merged: Record<string, AgentState> = { ...c };
      for (const [paneId, state] of Object.entries(h)) {
        merged[prefix(paneId)] = state;
      }
      return merged;
    },

    createSession(input: CreateSessionInput): Promise<TerminalSessionInfo> {
      return cockpit.backend.createSession(input);
    },
    integrationStates: () => cockpit.backend.integrationStates(),
    pushSubscriberCount: () => cockpit.backend.pushSubscriberCount(),

    send(params: TerminalSendParams): Promise<void> {
      const { backend, paneId } = route(params.claudeUuid);
      return backend.send({ ...params, claudeUuid: paneId });
    },
    teardown(key: string): Promise<TeardownResult> {
      const { backend, paneId } = route(key);
      return backend.teardown(paneId);
    },
    readTranscriptPage(
      key: string,
      before: Parameters<HerdrTerminalBackend["readTranscriptPage"]>[1],
    ) {
      const { backend, paneId } = route(key);
      return backend.readTranscriptPage(paneId, before);
    },
    readCapabilities(key: string, opts?: { refresh?: boolean }) {
      const { backend, paneId } = route(key);
      return backend.readCapabilities(paneId, opts);
    },
    paneCwd(key: string): Promise<string | null> {
      const { backend, paneId } = route(key);
      return backend.paneCwd(paneId);
    },
    hasSession(key: string): TerminalHasSessionResult {
      const { backend, paneId, side } = route(key);
      const result = backend.hasSession(paneId);
      return side === "hangar" && result.paneRef !== undefined
        ? { ...result, paneRef: prefix(result.paneRef) }
        : result;
    },
    registerClient(key: string, sink: ClientSink, owner?: unknown): void {
      const { backend, paneId, side } = route(key);
      backend.registerClient(paneId, side === "hangar" ? wrapSink(sink, paneId) : sink, owner);
    },
    getClient(key: string): ClientSink | undefined {
      const { backend, paneId } = route(key);
      return backend.getClient(paneId);
    },

    async resolvePermission(
      requestId: string,
      answer: { optionId?: string; allow?: boolean },
    ): Promise<boolean> {
      const held = holder(requestId);
      return held ? held.backend.resolvePermission(requestId, answer) : false;
    },
    paneIdForRequest(requestId: string): string | undefined {
      const held = holder(requestId);
      if (!held) return undefined;
      const paneId = held.backend.paneIdForRequest(requestId);
      return paneId !== undefined && held.side === "hangar" ? prefix(paneId) : paneId;
    },
    isPermissionCurrent(requestId: string): boolean {
      return holder(requestId)?.backend.isPermissionCurrent(requestId) ?? false;
    },
    permissionAutoDenyMs(requestId: string): number | undefined {
      return holder(requestId)?.backend.permissionAutoDenyMs(requestId);
    },

    pausePermissions(): void {
      cockpit.backend.pausePermissions();
      hangar?.backend.pausePermissions();
    },
    async resumePermissions(): Promise<void> {
      const results = await Promise.allSettled([
        cockpit.backend.resumePermissions(),
        hangar ? hangar.backend.resumePermissions() : Promise.resolve(),
      ]);
      for (const r of results) if (r.status === "rejected") throw r.reason;
    },
    cleanupByOwner(owner: unknown): void {
      cockpit.backend.cleanupByOwner(owner);
      hangar?.backend.cleanupByOwner(owner);
    },
    async teardownAll(): Promise<void> {
      for (const watch of watches) watch.stop();
      await Promise.all([
        cockpit.backend.teardownAll(),
        hangar ? hangar.backend.teardownAll() : Promise.resolve(),
      ]);
    },
    listLive(): string[] {
      return [
        ...cockpit.backend.listLive(),
        ...(hangar ? hangar.backend.listLive().map(prefix) : []),
      ];
    },
  };
}

export type SidedBackend = ReturnType<typeof createSidedBackend>;
