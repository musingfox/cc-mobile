/**
 * EventBuffer — in-memory ring buffer for WebSocket message replay on reconnect
 */

export interface BufferedEvent {
  eventId: number;
  sessionId: string;
  message: any;
  timestamp: number;
}

interface SessionBuffer {
  events: BufferedEvent[];
  nextId: number;
  /** Highest eventId dropped by overflow; 0 when nothing was. See `hasGap`. */
  lostThrough: number;
}

export class EventBuffer {
  private readonly maxSize: number;
  private readonly sessions: Map<string, SessionBuffer>;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
    this.sessions = new Map();
  }

  /**
   * Add event to buffer, returns assigned eventId (monotonic per session, starting at 1)
   */
  append(sessionId: string, message: any): number {
    let sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer) {
      sessionBuffer = {
        events: [],
        nextId: 1,
        lostThrough: 0,
      };
      this.sessions.set(sessionId, sessionBuffer);
    }

    const eventId = sessionBuffer.nextId++;
    const event: BufferedEvent = {
      eventId,
      sessionId,
      message,
      timestamp: Date.now(),
    };

    sessionBuffer.events.push(event);

    // Buffer overflow: drop oldest event
    if (sessionBuffer.events.length > this.maxSize) {
      const dropped = sessionBuffer.events.shift();
      if (dropped) sessionBuffer.lostThrough = dropped.eventId;
    }

    return eventId;
  }

  /**
   * Retrieve events after lastEventId (exclusive — returns eventId > afterEventId)
   */
  replay(sessionId: string, afterEventId: number): BufferedEvent[] {
    const sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer || sessionBuffer.events.length === 0) {
      return [];
    }

    return sessionBuffer.events.filter((event) => event.eventId > afterEventId);
  }

  /**
   * Get latest event ID for session
   */
  getLatestEventId(sessionId: string): number | null {
    const sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer || sessionBuffer.events.length === 0) {
      return null;
    }

    return sessionBuffer.events[sessionBuffer.events.length - 1].eventId;
  }

  /**
   * Whether a client whose cursor stands at `afterEventId` missed events this
   * buffer can no longer replay. Only overflow loses events: what `clear`
   * removed was retired on purpose, and a replay that starts past it is whole.
   */
  hasGap(sessionId: string, afterEventId: number): boolean {
    const sessionBuffer = this.sessions.get(sessionId);
    return sessionBuffer !== undefined && afterEventId < sessionBuffer.lostThrough;
  }

  /**
   * Drops every buffered event for the session. Ids keep counting from where
   * they were: the client holds a per-session cursor and asks for events after
   * it, so a sequence that restarted at 1 would read to every phone holding a
   * higher cursor as "already seen" — the events after a clear would never be
   * replayed to it.
   */
  clear(sessionId: string): void {
    const sessionBuffer = this.sessions.get(sessionId);
    if (!sessionBuffer) return;
    sessionBuffer.events = [];
    sessionBuffer.lostThrough = 0;
  }

  /**
   * Get buffer stats
   */
  getStats(sessionId: string): { count: number; oldest: number | null; newest: number | null } {
    const sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer || sessionBuffer.events.length === 0) {
      return { count: 0, oldest: null, newest: null };
    }

    return {
      count: sessionBuffer.events.length,
      oldest: sessionBuffer.events[0].eventId,
      newest: sessionBuffer.events[sessionBuffer.events.length - 1].eventId,
    };
  }
}
